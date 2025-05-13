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
  };
  
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
  
  // Clean up orphaned content that doesn't match current pages
  await cleanupOrphanedContent(processedPageIds, contentFiles);
  
  console.info('[Info] Notion to Markdown conversion complete');
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
    } catch (error) {
      console.error(`[Error] Failed to remove orphaned file ${file.filepath}: ${error}`);
    }
  }
}

// Run the main function
main().catch(error => {
  console.error('[Error] Failed to run Notion to Markdown conversion:', error);
  process.exit(1);
});
