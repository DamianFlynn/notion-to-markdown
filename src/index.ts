import { Client } from '@notionhq/client';
import * as dotenv from 'dotenv';
import { loadConfig } from './config';
import { buildContentFileMap, buildSourcePageMap, compareAndCreateActionMap, ensureTargetDirectories, ContentFileMapItem, PageMapItem } from './pageMap';
import { PropertyMap } from './types';
import { renderPage } from './render';
import fs from 'fs-extra';
import path from 'path';
import { getPageTitle } from './helpers';

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
  
  // IMPORTANT: Track page ID to filename mappings to detect renames
  const pageIdToFilename: Map<string, string> = new Map();
  for (const file of contentFiles) {
    pageIdToFilename.set(file.id, file.filepath);
  }
  
  // Track files that need to be cleaned up due to renames
  const filesToCleanup: string[] = [];
  
  // Log actions
  console.info('[Info] Action summary:');
  console.info(`       - ${actionMap.toCreate.length} pages to create`);
  console.info(`       - ${actionMap.toUpdate.length} pages to update`);
  console.info(`       - ${actionMap.unchanged.length} pages unchanged`);
  console.info(`       - ${actionMap.toDelete.length} pages to delete`);
  
  // Create target directories
  ensureTargetDirectories(actionMap);
  
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
    
    // Check if this is a renamed page
    const oldFilePath = pageIdToFilename.get(page.id);
    const outPath = path.join('content', page.targetFolder, page.outputName);
    
    if (oldFilePath && path.basename(oldFilePath) !== page.outputName) {
      // This is a renamed page - mark the old file for cleanup
      console.info(`[Info] Detected page rename: "${path.basename(oldFilePath)}" -> "${page.outputName}"`);
      filesToCleanup.push(oldFilePath);
    }
    
    console.info(`[Info] Processing page ${page.title} to ${outPath}`);
    
    try {
      const { content } = await renderPage(page.page, defaultPropertyMap, { notion });
      fs.writeFileSync(outPath, content);
    } catch (error) {
      console.error(`[Error] Failed to process page ${page.title}: ${error}`);
    }
  }
  
  // Clean up renamed files
  for (const filePath of filesToCleanup) {
    if (fs.existsSync(filePath)) {
      console.info(`[Info] Removing renamed file: ${filePath}`);
      fs.unlinkSync(filePath);
    }
  }
  
  // Delete pages that no longer exist
  for (const file of actionMap.toDelete) {
    console.info(`[Info] Deleting ${file.filepath}`);
    if (fs.existsSync(file.filepath)) {
      fs.unlinkSync(file.filepath);
    }
  }
  
  // After processing all pages, keep track of all successfully processed page IDs
  const processedPageIds = new Set<string>();
  const processedPageOutputs = new Set<string>();
  
  for (const page of [...actionMap.toCreate, ...actionMap.toUpdate, ...actionMap.unchanged]) {
    if (page.shouldProcess) {
      processedPageIds.add(page.id);
      // Also track the expected output filenames
      processedPageOutputs.add(path.join('content', page.targetFolder, page.outputName));
    }
  }
  
  // Clean up orphaned content that doesn't match current pages
  await cleanupOrphanedContent(processedPageIds, processedPageOutputs, contentFiles);
  
  console.info('[Info] Notion to Markdown conversion complete');
}

// Updated function to clean up orphaned content
async function cleanupOrphanedContent(
  processedPageIds: Set<string>, 
  processedOutputs: Set<string>,
  contentFiles: ContentFileMapItem[]
): Promise<void> {
  console.info('[Info] Checking for orphaned content files to clean up...');
  
  // Find files that exist in the filesystem but aren't in the processed pages list
  // or don't match the expected output filename (renamed pages)
  const orphanedFiles = contentFiles.filter(file => {
    // If the page ID isn't in our processed set, it's orphaned
    if (!processedPageIds.has(file.id)) return true;
    
    // If the page ID is processed but the filename doesn't match expected output, it's orphaned
    // (This catches renames that weren't handled earlier)
    return !processedOutputs.has(file.filepath);
  });
  
  if (orphanedFiles.length === 0) {
    console.info('[Info] No orphaned content files found');
    return;
  }
  
  console.info(`[Info] Found ${orphanedFiles.length} orphaned content files to clean up`);
  
  for (const file of orphanedFiles) {
    try {
      if (fs.existsSync(file.filepath)) {
        console.info(`[Info] Removing orphaned file: ${file.filepath}`);
        fs.unlinkSync(file.filepath);
        
        // Also check if there are orphaned images associated with this page
        cleanupOrphanedImages(file.id);
      }
    } catch (error) {
      console.error(`[Error] Failed to remove orphaned file ${file.filepath}: ${error}`);
    }
  }
}

// Add this function to clean up orphaned images
function cleanupOrphanedImages(pageId: string): void {
  const pageIdPrefix = pageId.replace(/-/g, '').substring(0, 8);
  const imageDir = path.join(process.cwd(), 'static/images');
  
  if (!fs.existsSync(imageDir)) {
    return;
  }
  
  try {
    const files = fs.readdirSync(imageDir);
    const pageImagePattern = `notion-${pageIdPrefix}-`;
    
    const orphanedImages = files.filter(file => 
      file.startsWith(pageImagePattern) && 
      !file.startsWith('.')
    );
    
    for (const image of orphanedImages) {
      const imagePath = path.join(imageDir, image);
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
