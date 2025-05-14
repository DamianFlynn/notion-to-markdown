import { Client } from '@notionhq/client';
import * as dotenv from 'dotenv';
import { loadConfig } from './config';
import { buildContentFileMap, buildSourcePageMap, compareAndCreateActionMap, ensureTargetDirectories, ContentFileMapItem, PageMapItem } from './pageMap';
import { PropertyMap } from './types';
import { renderPage } from './render';
import fs from 'fs-extra';
import path from 'path';
import { getPageTitle } from './helpers';
import { getBundlePath, ensureBundleDirectory } from './utils/bundle';
import { DEFAULT_HUGO_BUNDLE_CONFIG } from './types/hugo';

// Load environment variables from .env file
dotenv.config();

// Verify that the required NOTION_TOKEN is present
const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error('[Error] Missing NOTION_TOKEN environment variable');
  process.exit(1);
}

// Create a new Notion client
const notion = new Client({
  auth: NOTION_TOKEN,
});

async function main() {
  console.info('[Info] Starting Notion to Markdown conversion');
  
  // Load the config
  const config = await loadConfig();
  console.info('[Info] Config loaded');
  
  // Build maps
  const sourcePages = await buildSourcePageMap(
    notion, 
    config.mount.databases, 
    config.mount.pages
  );
  console.info(`[Info] Found ${sourcePages.length} source pages in Notion`);
  
  // Build map of existing content files
  const contentFiles = buildContentFileMap();
  console.info(`[Info] Found ${contentFiles.length} existing markdown files`);
  
  // Compare maps and determine what actions to take
  const actionMap = compareAndCreateActionMap(sourcePages, contentFiles);
  
  // Track files that need to be cleaned up (old flat files when converting to bundles)
  const filesToCleanup: string[] = [];
  
  // Track successful bundle conversions for image cleanup
  const bundleConversions: {oldPath: string, newBundlePath: string, pageId: string}[] = [];
  
  // Log actions
  console.info('[Info] Action summary:');
  console.info(`       - ${actionMap.toCreate.length} pages to create`);
  console.info(`       - ${actionMap.toUpdate.length} pages to update`);
  console.info(`       - ${actionMap.unchanged.length} pages unchanged`);
  console.info(`       - ${actionMap.toDelete.length} pages to delete`);
  
  // Create default property map
  const defaultPropertyMap: PropertyMap = {
    // Add default mappings as needed
    "Name": { name: "title", type: "title" },
    "Status": { name: "Status", type: "status" },
    "Categories": { name: "Categories", type: "multi_select" },
    "Tags": { name: "Tags", type: "multi_select" },
    "Author": { name: "Author", type: "people" },
    "Publish Date": { name: "date", type: "date" },
    "Series": { name: "series", type: "select" },    // Added series mapping
    "Weight": { name: "weight", type: "number" },     // Added weight for series ordering
    "Summary": { name: "description", type: "rich_text" }, // Add summary/description mapping
    "Description": { name: "description", type: "rich_text" } // Alternative field name
  };

  // Find matching content file for each page to track legacy files that need cleanup
  const legacyMapping = new Map<string, string>();
  for (const page of [...actionMap.toUpdate]) {
    const matchingFile = contentFiles.find(file => file.id === page.id);
    if (matchingFile) {
      legacyMapping.set(page.id, matchingFile.filepath);
    }
  }
  
  // Process pages to create or update
  const pagesToProcess = [...actionMap.toCreate, ...actionMap.toUpdate];
  for (let i = 0; i < pagesToProcess.length; i++) {
    const page = pagesToProcess[i];
    console.info(`[Info] Processing ${i+1}/${pagesToProcess.length}: ${page.title}`);
    
    if (!page.page) {
      console.warn(`[Warning] Page ${page.title} (${page.id}) has no content, skipping`);
      continue;
    }
    
    console.info(`[Info] Processing page ${page.title} to ${page.targetFolder}`);
    
    try {
      const { content, bundlePath } = await renderPage(page.page, defaultPropertyMap, { 
        notion,
        targetFolder: page.targetFolder
      });
      
      // Check if this is a conversion from flat to bundle structure
      const oldFilePath = legacyMapping.get(page.id);
      const isConvertingToBundle = oldFilePath && 
                                  bundlePath.isBundle && 
                                  path.basename(oldFilePath) !== bundlePath.indexFileName;
      
      // If converting from flat to bundle, track the old file for cleanup
      if (isConvertingToBundle) {
        console.info(`[Info] Converting ${path.basename(oldFilePath)} to bundle structure: ${bundlePath.bundleDirPath}`);
        filesToCleanup.push(oldFilePath);
        
        // Track this conversion for image cleanup
        bundleConversions.push({
          oldPath: oldFilePath,
          newBundlePath: bundlePath.bundleDirPath,
          pageId: page.id
        });
      }
      
      // Ensure bundle directory exists
      ensureBundleDirectory(bundlePath);
      
      // Write content to index file
      fs.writeFileSync(bundlePath.indexFilePath, content);
      
      console.info(`[Info] Successfully saved ${bundlePath.indexFilePath}`);
    } catch (error) {
      console.error(`[Error] Failed to process page ${page.title}: ${error}`);
    }
  }
  
  // Delete pages that no longer exist
  for (const file of actionMap.toDelete) {
    const filePath = file.filepath;
    console.info(`[Info] Deleting ${filePath}`);
    
    if (fs.existsSync(filePath)) {
      // Check if this is a bundle (directory with index.md)
      const dirPath = path.dirname(filePath);
      const fileName = path.basename(filePath);
      
      if (fileName === 'index.md') {
        // This is a bundle, remove the entire directory
        fs.removeSync(dirPath);
        console.info(`[Info] Removed bundle directory ${dirPath}`);
      } else {
        // This is a flat file, just remove the file
        fs.unlinkSync(filePath);
        console.info(`[Info] Removed flat file ${filePath}`);
      }
    }
  }
  
  // After processing all pages, keep track of all successfully processed page IDs
  const processedPageIds = new Set<string>();
  
  for (const page of [...actionMap.toCreate, ...actionMap.toUpdate, ...actionMap.unchanged]) {
    if (page.shouldProcess) {
      processedPageIds.add(page.id);
    }
  }
  
  // Clean up files that were migrated from flat to bundle structure
  for (const oldFilePath of filesToCleanup) {
    if (fs.existsSync(oldFilePath)) {
      console.info(`[Info] Removing original file after conversion to bundle: ${oldFilePath}`);
      fs.unlinkSync(oldFilePath);
    }
  }
  
  // Move images from static/images to bundle folders for migrated pages
  for (const conversion of bundleConversions) {
    await migrateImagesToBundle(conversion.pageId, conversion.newBundlePath);
  }
  
  // Clean up orphaned content that doesn't match current pages
  await cleanupOrphanedContent(processedPageIds, contentFiles);
  
  console.info('[Info] Notion to Markdown conversion complete');
}

/**
 * Migrate images from static/images to the bundle directory
 */
async function migrateImagesToBundle(pageId: string, bundleDirPath: string): Promise<void> {
  const staticImagesDir = path.join('static', 'images');
  if (!fs.existsSync(staticImagesDir)) {
    return;
  }
  
  try {
    const pageIdShort = pageId.replace(/-/g, '').substring(0, 8);
    const pageImagePattern = new RegExp(`(?:notion|img)-${pageIdShort}-`);
    
    // Find all images related to this page
    const allImages = fs.readdirSync(staticImagesDir)
      .filter(file => pageImagePattern.test(file) && !file.startsWith('.'));
    
    if (allImages.length === 0) {
      return;
    }
    
    console.info(`[Info] Migrating ${allImages.length} images to bundle: ${bundleDirPath}`);
    
    for (const imageName of allImages) {
      const sourceImagePath = path.join(staticImagesDir, imageName);
      const targetImagePath = path.join(bundleDirPath, imageName);
      
      try {
        // Copy image to bundle directory
        fs.copyFileSync(sourceImagePath, targetImagePath);
        
        // Update references in content file
        const contentFilePath = path.join(bundleDirPath, 'index.md');
        if (fs.existsSync(contentFilePath)) {
          let content = fs.readFileSync(contentFilePath, 'utf-8');
          
          // Update image references from /static/images/name.jpg to ./name.jpg
          content = content.replace(
            new RegExp(`\\(/(?:static/)?images/${imageName}\\)`, 'g'),
            `(./${imageName})`
          );
          
          fs.writeFileSync(contentFilePath, content);
        }
        
        // Remove the original image file
        fs.unlinkSync(sourceImagePath);
        console.debug(`[Debug] Migrated image: ${imageName} to bundle structure`);
      } catch (error) {
        console.error(`[Error] Failed to migrate image ${imageName} to bundle: ${error}`);
      }
    }
  } catch (error) {
    console.error(`[Error] Failed to migrate images for page ${pageId}: ${error}`);
  }
}

// Updated function to clean up orphaned content with bundle support
async function cleanupOrphanedContent(
  processedPageIds: Set<string>, 
  contentFiles: ContentFileMapItem[]
): Promise<void> {
  console.info('[Info] Checking for orphaned content files to clean up...');
  
  // Find files that exist in the filesystem but aren't in the processed pages list
  const orphanedFiles = contentFiles.filter(file => !processedPageIds.has(file.id));
  
  if (orphanedFiles.length === 0) {
    console.info('[Info] No orphaned content files found');
    return;
  }
  
  console.info(`[Info] Found ${orphanedFiles.length} orphaned content files to clean up`);
  
  for (const file of orphanedFiles) {
    try {
      if (fs.existsSync(file.filepath)) {
        // Check if this is a bundle
        const dirPath = path.dirname(file.filepath);
        const fileName = path.basename(file.filepath);
        
        if (fileName === 'index.md') {
          // This is a bundle, remove the entire directory
          fs.removeSync(dirPath);
          console.info(`[Info] Removed orphaned bundle directory ${dirPath}`);
        } else {
          // This is a flat file, just remove the file
          fs.unlinkSync(file.filepath);
          console.info(`[Info] Removing orphaned file: ${file.filepath}`);
        }
      }
      
      // Also clean up orphaned images for this file
      cleanupOrphanedImages(file.id);
    } catch (error) {
      console.error(`[Error] Failed to remove orphaned file ${file.filepath}: ${error}`);
    }
  }
}

/**
 * Clean up orphaned images for a specific page ID
 */
function cleanupOrphanedImages(pageId: string): void {
  const staticImagesDir = path.join('static', 'images');
  if (!fs.existsSync(staticImagesDir)) {
    return;
  }
  
  try {
    const pageIdShort = pageId.replace(/-/g, '').substring(0, 8);
    const pageImagePattern = new RegExp(`(?:notion|img)-${pageIdShort}-`);
    
    // Find all images related to this page
    const orphanedImages = fs.readdirSync(staticImagesDir)
      .filter(file => pageImagePattern.test(file) && !file.startsWith('.'));
    
    for (const imageName of orphanedImages) {
      const imagePath = path.join(staticImagesDir, imageName);
      console.info(`[Info] Removing orphaned image: ${imagePath}`);
      fs.unlinkSync(imagePath);
    }
  } catch (error) {
    console.error(`[Error] Failed to clean up orphaned images for page ${pageId}: ${error}`);
  }
}

// Run the main function
main().catch(error => {
  console.error('[Error] Failed to run Notion to Markdown conversion:', error);
  process.exit(1);
});
