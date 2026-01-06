import { Client, isFullPage } from "@notionhq/client";
import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import slugify from "slugify";

/**
 * Gets the title of a Notion page
 */
export function getPageTitle(page: PageObjectResponse): string {
  if (!page.properties) {
    return "Untitled";
  }
  
  // Look for title property
  for (const [key, prop] of Object.entries(page.properties)) {
    if (prop && typeof prop === 'object' && 'type' in prop && prop.type === "title" && 'title' in prop && prop.title && prop.title.length > 0) {
      return prop.title.map((text: any) => text.plain_text).join("");
    }
  }

  // If no title property was found, look for a Name property
  const nameProperty = Object.values(page.properties).find(
    prop => prop && typeof prop === 'object' && 'type' in prop && prop.type === "title"
  );
  
  if (nameProperty && 'title' in nameProperty && nameProperty.title?.length) {
    return nameProperty.title.map((text: any) => text.plain_text).join("");
  }
  
  return "Untitled";
}

export function getPagePublishDate(page: PageObjectResponse): string {
  const publishDateProperty = page.properties["Publish Date"];

  if (
    publishDateProperty &&
    publishDateProperty.type === "date" &&
    publishDateProperty.date
  ) {
    return publishDateProperty.date.start;
  }

  // If publishDateProperty is not defined or is empty, use page.created_time
  return page.created_time;
}

export function getPageShouldBeProcessed(page: PageObjectResponse): boolean {
  // Check if it's a child page first
  if (page.parent.type === "page_id") {
    console.info(
      `[Info] The post ${getPageTitle(page)} is a child page, processing.`,
    );
    return true;
  }
  
  // Default to processing the page
  let shouldProcess = true;
  
  // Check for Format = "Social" and Platform = "Blog"
  let hasCorrectFormat = false;
  let hasCorrectPlatform = false;
  
  if (page.properties) {
    for (const [key, prop] of Object.entries(page.properties)) {
      // Skip if prop is null or undefined
      if (!prop || typeof prop !== 'object' || !('type' in prop)) continue;
      
      // Check Format property - must be "Social"
      if ((key === "Format" || key === "format")) {
        if (prop.type === "select" && 'select' in prop) {
          if (prop.select && prop.select.name) {
            const format = prop.select.name;
            if (format === "Social") {
              hasCorrectFormat = true;
            } else {
              console.info(`[Info] The page ${getPageTitle(page)} has format "${format}" instead of "Social", skipped.`);
              return false;
            }
          }
        }
      }
      
      // Check Platform property - must be "Blog"
      if ((key === "Platform" || key === "platform")) {
        if (prop.type === "select" && 'select' in prop) {
          if (prop.select && prop.select.name) {
            const platform = prop.select.name;
            if (platform === "Blog") {
              hasCorrectPlatform = true;
            } else {
              console.info(`[Info] The page ${getPageTitle(page)} has platform "${platform}" instead of "Blog", skipped.`);
              return false;
            }
          }
        }
      }
      
      // Check for Status property
      if (prop.type === "status" && 'status' in prop) {
        if (prop.status && prop.status.name) {
          const status = prop.status.name.toLowerCase();
          
          // Skip pages that are not ready to be published
          if (status === "draft" || status === "in progress") {
            console.info(`[Info] The post ${getPageTitle(page)} is not ready to be published, skipped.`);
            shouldProcess = false;
            break;
          }
        }
      }
    }
  }
  
  // Only process if it has the correct format AND platform
  if (!hasCorrectFormat) {
    console.info(`[Info] The page ${getPageTitle(page)} does not have Format property set to "Social", skipped.`);
    return false;
  }
  
  if (!hasCorrectPlatform) {
    console.info(`[Info] The page ${getPageTitle(page)} does not have Platform property set to "Blog", skipped.`);
    return false;
  }
  
  return shouldProcess;
}

export async function getCoverLink(
  page_id: string,
  notion: Client,
): Promise<{ link: string; expiry_time: string | null } | null> {
  const page = await notion.pages.retrieve({ page_id });
  if (!isFullPage(page)) return null;
  if (page.cover === null) return null;
  if (page.cover.type === "external")
    return {
      link: page.cover.external.url,
      expiry_time: null,
    };
  else
    return {
      link: page.cover.file.url,
      expiry_time: page.cover.file.expiry_time,
    };
}

/**
 * Simple sleep function for async operations
 * @param ms Number of milliseconds to sleep
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getFileName(title: string, page_id: string): string {
  // Create a slug from the title
  const slug = slugify(title, {
    lower: true,
    strict: true,
    replacement: "-"
  });
  
  // Append the page ID to ensure uniqueness
  return `${slug}-${page_id.replace(/-/g, "")}.md`;
}

/**
 * Get content file with a fallback retrieval method
 * Use this instead of direct imports from file.ts to avoid circular dependencies
 */
export function getContentFileWithFallback(filepath: string): any | null {
  try {
    const { getContentFileByPath } = require('./file');
    return getContentFileByPath(filepath);
  } catch (error) {
    console.error(`[Error] Failed to get content file ${filepath}: ${error}`);
    return null;
  }
}
