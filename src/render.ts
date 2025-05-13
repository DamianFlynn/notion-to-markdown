import fs from "fs-extra";
import { Client, isFullUser, iteratePaginatedAPI } from "@notionhq/client";
import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { NotionToMarkdown } from "./markdown/notion-to-md";
import YAML from "yaml";
import { sh } from "./sh";
import { DatabaseMount, PageMount } from "./config";
import {
  getPageTitle,
  getPagePublishDate,
  getPageShouldBeProcessed,
  getCoverLink,
  getFileName,
} from "./helpers";
import { MdBlock } from "./markdown/types";
import path from "path";
import { getContentFile } from "./file";
import { withRetry, createFaultTolerantFunction } from "./utils";
import { processImagesInMarkdown } from './imageHandler';
import { PropertyMap, RenderOptions, RenderResult, NotionToMarkdown as N2M } from "./types";
import { getBundlePath, BundlePath, ensureBundleDirectory } from "./utils/bundle";
import { DEFAULT_HUGO_BUNDLE_CONFIG } from './types/hugo';

/**
 * Configuration options for retrying failed operations
 */
const RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 5000,
  factor: 2
};

/**
 * Error information for property processing
 */
interface PropertyError {
  /**
   * Error message
   */
  error: string;
  
  /**
   * Type of error
   */
  errorType: string;
  
  /**
   * Timestamp when the error occurred
   */
  timestamp: string;
}

/**
 * Map of property names to error information
 */
interface PropertyProcessingErrors {
  [key: string]: PropertyError;
}

/**
 * Helper function to retry operations with exponential backoff
 * 
 * @param operation - Function to execute with retry logic
 * @param retryCount - Current retry attempt count
 * @param delay - Delay in milliseconds before next attempt
 * @returns Promise resolving to the operation result
 */
async function retryOperation<T>(
  operation: () => Promise<T>,
  retryCount: number = 0,
  delay: number = RETRY_OPTIONS.initialDelay
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (
      error.code === 'notionhq_client_request_timeout' &&
      retryCount < RETRY_OPTIONS.maxRetries
    ) {
      console.warn(`[Warning] Request timeout. Retrying (${retryCount + 1}/${RETRY_OPTIONS.maxRetries}) after ${delay}ms delay...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Calculate next delay with exponential backoff (plus some jitter)
      const nextDelay = Math.min(
        delay * RETRY_OPTIONS.factor * (0.9 + Math.random() * 0.2),
        RETRY_OPTIONS.maxDelay
      );
      
      return retryOperation(operation, retryCount + 1, nextDelay);
    }
    throw error;
  }
}

/**
 * Extract expiry time from a list of Notion blocks
 * 
 * @param blocks - List of Markdown blocks to check for expiry times
 * @param currentExpiry - Current expiry time to compare against
 * @returns The earliest expiry time found, or null if none
 */
function getExpiryTime(blocks: MdBlock[], currentExpiry: string | null = null): string | null {
  if (!blocks || blocks.length === 0) {
    return currentExpiry;
  }
  
  let latestExpiry = currentExpiry;
  
  for (const block of blocks) {
    // Check for images and files which might have expiry times
    if (block.type === 'image' && block.image) {
      // Handle file and external URLs differently - only file URLs from Notion have expiry times
      if (block.image.file && block.image.file.url) {
        // Safely access expiry_time which might not exist on all file objects
        const expiryTime = (block.image.file as any).expiry_time;
        if (expiryTime) {
          if (!latestExpiry || new Date(expiryTime) < new Date(latestExpiry)) {
            latestExpiry = expiryTime;
          }
        }
      }
    }
    
    // Check for file blocks
    if (block.type === 'file' && block.file) {
      // Safely access expiry_time which might not exist on all file objects
      const expiryTime = (block.file as any).expiry_time;
      if (expiryTime) {
        if (!latestExpiry || new Date(expiryTime) < new Date(latestExpiry)) {
          latestExpiry = expiryTime;
        }
      }
    }
    
    // Check children recursively
    if (block.children && block.children.length > 0) {
      const childExpiryTime = getExpiryTime(block.children, latestExpiry);
      if (childExpiryTime) {
        if (!latestExpiry || new Date(childExpiryTime) < new Date(latestExpiry)) {
          latestExpiry = childExpiryTime;
        }
      }
    }
  }
  
  return latestExpiry;
}

/**
 * Configure custom transformers for Notion blocks
 * 
 * @param n2m - NotionToMarkdown instance to configure
 */
function loadCustomTransformers(n2m: NotionToMarkdown): void {
  // Custom transformer for callout block
  n2m.setCustomTransformer("callout", (block: MdBlock) => {
    if (!block.callout) return ''; // Skip if no callout property
    
    const emoji = block.callout.icon?.emoji || "";
    const content = block.callout.rich_text
      ? block.callout.rich_text.map((richText: any) => richText.plain_text).join("")
      : "";
      
    // Convert callouts with warning/info emojis to admonitions
    if (emoji === "⚠️" || emoji === "💡" || emoji === "ℹ️") {
      let type = "note";
      if (emoji === "⚠️") type = "warning";
      if (emoji === "💡") type = "tip";
      
      return `\n> [!${type}] ${emoji} \n> ${content}\n`;
    }
    
    return `> ${emoji} ${content}\n`;
  });
  
  // Add more custom transformers as needed
}

/**
 * Create front matter for Hugo from Notion page properties
 * 
 * @param page - Notion page object
 * @param propertyMap - Map of property names to front matter fields
 * @returns YAML front matter as a string
 */
export function createFrontMatter(page: PageObjectResponse, propertyMap: PropertyMap): string {
  const frontMatterObj: Record<string, any> = {
    title: getPageTitle(page),
    date: page.created_time,
    lastmod: page.last_edited_time,
    draft: true,
  };
  
  // Process each property in the page
  if (page.properties) {
    Object.entries(page.properties).forEach(([key, property]) => {
      const mapping = propertyMap[key];
      if (mapping) {
        // Extract the property value based on its type
        try {
          switch (property.type) {
            case "title":
              // Title is already handled above
              break;
            case "rich_text":
              if (property.rich_text.length > 0) {
                frontMatterObj[mapping.name] = property.rich_text.map((rt: any) => rt.plain_text).join("");
              }
              break;
            case "select":
              if (property.select) {
                frontMatterObj[mapping.name] = property.select.name;
              }
              break;
            case "multi_select":
              if (property.multi_select.length > 0) {
                frontMatterObj[mapping.name] = property.multi_select.map((ms: any) => ms.name);
              }
              break;
            case "date":
              if (property.date) {
                frontMatterObj[mapping.name] = property.date.start;
              }
              break;
            case "status":
              if (property.status) {
                frontMatterObj[mapping.name] = property.status.name;
                
                // Set draft status based on Status property
                if (property.status.name === "Published") {
                  frontMatterObj.draft = false;
                }
              }
              break;
            case "people":
              if (property.people.length > 0) {
                frontMatterObj[mapping.name] = property.people.map((p: any) => p.name || "Unknown");
                // Also add authors for Hugo's built-in SEO
                frontMatterObj.authors = property.people.map((p: any) => p.name || "Unknown");
              }
              break;
            case "number":
              if (property.number !== null) {
                frontMatterObj[mapping.name] = property.number;
              }
              break;
            case "checkbox":
              frontMatterObj[mapping.name] = property.checkbox;
              break;
            // Add more property types as needed
          }
        } catch (error) {
          console.warn(`[Warning] Failed to process property ${key}: ${error}`);
        }
      }
    });
  }
  
  // Add Notion metadata for tracking
  frontMatterObj.NOTION_METADATA = {
    object: page.object,
    id: page.id,
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
    created_by: page.created_by,
    last_edited_by: page.last_edited_by,
    cover: page.cover,
    icon: page.icon,
    parent: page.parent,
    archived: page.archived,
    properties: {}, // Simplified properties for tracking
    url: page.url,
    public_url: page.public_url
  };
  
  // Record update time for tracking
  frontMatterObj.UPDATE_TIME = new Date().toISOString();
  frontMatterObj.last_edited_time = page.last_edited_time;
  
  // Convert to YAML
  try {
    return YAML.stringify(frontMatterObj);
  } catch (error) {
    console.error(`[Error] Failed to generate YAML: ${error}`);
    return `title: "${getPageTitle(page)}"\nid: "${page.id}"\n`;
  }
}

/**
 * Render a page to markdown and front matter
 * 
 * @param page - Notion page to render
 * @param propertyMap - Map of property names to front matter fields
 * @param options - Rendering options
 * @returns Promise resolving to rendered content and title
 */
export async function renderPage(
  page: PageObjectResponse, 
  propertyMap: PropertyMap,
  options: RenderOptions = {}
): Promise<RenderResult> {
  console.debug(`[Debug] Rendering page ${page.id}`);
  
  // Create the NotionToMarkdown converter
  const n2m = new NotionToMarkdown({ notionClient: options.notion as Client });
  
  // Load custom transformers
  loadCustomTransformers(n2m);
  
  // Get the title
  const title = getPageTitle(page);
  console.debug(`[Debug] Page title: ${title}`);
  
  // Get the bundle path
  const bundlePath = getBundlePath({
    title,
    pageId: page.id,
    contentType: 'posts', // Default to posts
    targetFolder: options.targetFolder || '',
    bundleConfig: options.hugoConfig || DEFAULT_HUGO_BUNDLE_CONFIG
  });
  
  // Get the page content
  const pageBlocks = await n2m.pageToMarkdown(page.id);
  
  // Convert the blocks to markdown
  const markdown = n2m.toMarkdownString(pageBlocks);
  
  // Get the earliest expiry time from all page blocks
  const expiryTime = getExpiryTime(pageBlocks);
  if (expiryTime) {
    console.debug(`[Debug] Page has expiry time: ${expiryTime}`);
  }
  
  // Ensure bundle directory exists
  ensureBundleDirectory(bundlePath);
  
  // Process images in the markdown using the bundle structure
  const { content, downloadTasks } = await processImagesInMarkdown(
    markdown.parent, 
    page.id,
    bundlePath
  );
  
  // Wait for all image downloads to complete
  await Promise.all(downloadTasks);
  
  // Process front matter
  const frontMatter = createFrontMatter(page, propertyMap);
  
  // Add expiry time if found
  const frontMatterWithExpiry = expiryTime ? 
    `${frontMatter}\nEXPIRY_TIME: "${expiryTime}"` : 
    frontMatter;
  
  // Combine front matter and markdown
  const output = `---
${frontMatterWithExpiry}
---

${content}`;

  return { 
    content: output, 
    title,
    bundlePath 
  };
}

/**
 * Simplified render function for use with basic property mapping
 * 
 * @param page - Notion page to render
 * @param notion - Notion client instance
 * @returns Promise resolving to rendered content and title
 */
export async function renderPageSimple(page: PageObjectResponse, notion: Client): Promise<RenderResult> {
  // Create a minimal property map
  const propertyMap: PropertyMap = {};
  
  // Add default mappings for common properties
  if (page.properties) {
    Object.entries(page.properties).forEach(([key, prop]) => {
      // Add mapping based on property name
      propertyMap[key] = {
        name: key.toLowerCase().replace(/\s+/g, '_'),
        type: prop.type
      };
    });
  }
  
  // Call the full render function with our basic map and options
  return await renderPage(page, propertyMap, { notion });
}

/**
 * Process a page with given options
 * 
 * @param page - Notion page to process
 * @param notion - Notion client instance
 * @param targetPath - Path where the processed page should be saved
 * @returns Promise that resolves when processing is complete
 */
export async function processPage(page: PageObjectResponse, notion: Client, targetPath: string): Promise<void> {
  try {
    const result = await renderPageSimple(page, notion);
    await fs.promises.writeFile(targetPath, result.content, 'utf-8');
    console.debug(`[Debug] Successfully processed page to ${targetPath}`);
  } catch (error) {
    console.error(`[Error] Failed to process page: ${error}`);
    throw error;
  }
}

/**
 * Save a page to disk
 * 
 * @param page - Notion page to save
 * @param notion - Notion client instance
 * @param mount - Mount information for the page
 * @returns Promise that resolves when saving is complete
 */
export async function savePage(
  page: PageObjectResponse,
  notion: Client,
  mount: DatabaseMount | PageMount,
): Promise<void> {
  try {
    if (getPageShouldBeProcessed(page)) {
      const title = getPageTitle(page);
      
      console.info(`[Info] Processing page ${title} to ${mount.target_folder}`);
      
      // Get rendered page content
      const { content, bundlePath } = await renderPage(page, {}, { 
        notion,
        targetFolder: mount.target_folder
      });
      
      // Ensure target directory exists (bundle or parent directory)
      ensureBundleDirectory(bundlePath);
      
      // Write content to index file
      fs.writeFileSync(bundlePath.indexFilePath, content);
      
      console.info(`[Info] Successfully saved ${bundlePath.indexFilePath}`);
    }
  } catch (error) {
    console.error(`[Error] Failed to save page ${page.id}: ${error}`);
    throw error; // Re-throw so the calling code can handle it
  }
}

/**
 * Example function showing alternative usage of rendering
 * 
 * @param page - Notion page to process
 * @param notion - Notion client instance
 * @returns Promise that resolves when processing is complete
 */
export async function someOtherFunction(page: PageObjectResponse, notion: Client): Promise<void> {
  try {
    const { content } = await renderPageSimple(page, notion);
    console.debug(`[Debug] Generated content length: ${content.length}`);
  } catch (error) {
    console.error(`[Error] Failed in someOtherFunction: ${error}`);
  }
}
