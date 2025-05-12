import { Client, isFullPage, iteratePaginatedAPI } from "@notionhq/client";
import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import fs from "fs-extra";
import path from "path";
import { DatabaseMount, PageMount } from "./config";
import { getAllContentFiles } from "./file";
import { getPageTitle, getFileName, getPageShouldBeProcessed } from "./helpers";
import { withRetry } from "./utils";
import { getPageImages } from './imageTracker';

// Define interfaces for our mapping
export interface PageMapItem {
  id: string;
  title: string;
  outputName: string;
  lastEdited: string;
  targetFolder: string;
  mountType: 'database' | 'page';
  mountSource: string;
  page?: PageObjectResponse;
  shouldProcess: boolean;
}

export interface ContentFileMapItem {
  id: string;
  filepath: string;
  outputName: string;
  lastEdited: string;
  targetFolder: string;
  expiryTime: string | null;
  updateTime: string | null;
}

export interface PageActionMap {
  toCreate: PageMapItem[];
  toUpdate: PageMapItem[];
  toDelete: ContentFileMapItem[];
  unchanged: PageMapItem[];
  renamedPages?: Map<string, {oldName: string, newName: string}>;
}

/**
 * Builds a map of all pages from Notion databases and individual pages
 */
export async function buildSourcePageMap(
  notion: Client,
  databaseMounts: DatabaseMount[],
  pageMounts: PageMount[]
): Promise<PageMapItem[]> {
  const pageMap: PageMapItem[] = [];
  
  // Process database pages
  for (const mount of databaseMounts) {
    console.info(`[Info] Building page map for database ${mount.database_id}`);
    try {
      for await (const page of iteratePaginatedAPI(notion.databases.query, {
        database_id: mount.database_id,
      })) {
        if (page.object !== "page") continue;
        
        const pageObj = page as PageObjectResponse;
        const title = getPageTitle(pageObj);
        const outputName = getFileName(title, pageObj.id);
        const shouldProcess = getPageShouldBeProcessed(pageObj);
        
        pageMap.push({
          id: pageObj.id,
          title,
          outputName,
          lastEdited: pageObj.last_edited_time,
          targetFolder: mount.target_folder,
          mountType: 'database',
          mountSource: mount.database_id,
          page: pageObj,
          shouldProcess
        });
      }
    } catch (error: any) {
      console.error(`[Error] Failed to process database ${mount.database_id}: ${error.message}`);
      // Continue with other databases even if one fails
    }
  }

  // Process individual pages with retry logic
  for (const mount of pageMounts) {
    console.info(`[Info] Building page map for page ${mount.page_id}`);
    try {
      const pageObj = await withRetry(() => 
        notion.pages.retrieve({ page_id: mount.page_id })
      );
      
      if (!isFullPage(pageObj)) continue;
      
      const title = getPageTitle(pageObj);
      const outputName = getFileName(title, pageObj.id);
      const shouldProcess = getPageShouldBeProcessed(pageObj);
      
      pageMap.push({
        id: pageObj.id,
        title,
        outputName,
        lastEdited: pageObj.last_edited_time,
        targetFolder: mount.target_folder,
        mountType: 'page',
        mountSource: mount.page_id,
        page: pageObj,
        shouldProcess
      });
    } catch (error) {
      console.error(`[Error] Failed to retrieve page ${mount.page_id}: ${error}`);
    }
  }
  
  return pageMap;
}

/**
 * Builds a map of all content files in target directories
 */
export function buildContentFileMap(contentBasePath: string = "content"): ContentFileMapItem[] {
  console.info(`[Info] Building content file map from ${contentBasePath}`);
  const contentFileMap: ContentFileMapItem[] = [];
  
  if (!fs.existsSync(contentBasePath)) {
    console.info(`[Info] Content directory ${contentBasePath} does not exist yet`);
    return contentFileMap;
  }
  
  const contentFiles = getAllContentFiles(contentBasePath);
  console.info(`[Debug] Found ${contentFiles.length} markdown files in total`);
  
  for (const file of contentFiles) {
    if (!file.metadata) {
      console.warn(`[Warning] File ${file.filepath} has no metadata, skipping`);
      continue;
    }
    
    const id = file.metadata.id || 
               (file.metadata.NOTION_METADATA?.id) || 
               null;
    
    if (!id) {
      console.warn(`[Warning] File ${file.filepath} has no ID in metadata, skipping`);
      continue;
    }
    
    // Extract target folder from filepath
    const relativePath = path.relative(contentBasePath, path.dirname(file.filepath));
    
    contentFileMap.push({
      id,
      filepath: file.filepath,
      outputName: path.basename(file.filepath),
      lastEdited: file.metadata.last_edited_time || file.metadata.lastmod || '',
      targetFolder: relativePath || '.',
      expiryTime: file.metadata.EXPIRY_TIME || null,
      updateTime: file.metadata.UPDATE_TIME || null
    });
  }
  
  return contentFileMap;
}

/**
 * Compare source pages with content files to determine actions
 */
export function compareAndCreateActionMap(
  sourcePages: PageMapItem[], 
  contentFiles: ContentFileMapItem[]
): PageActionMap {
  console.info('[Info] Analyzing page and content maps to determine needed actions');
  
  const toCreate: PageMapItem[] = [];
  const toUpdate: PageMapItem[] = [];
  const unchanged: PageMapItem[] = [];
  const existingIds = new Set<string>();
  const renamedPages: Map<string, {oldName: string, newName: string}> = new Map();
  
  // First pass: determine what needs to be created/updated
  for (const sourcePage of sourcePages) {
    // Skip pages that shouldn't be processed
    if (!sourcePage.shouldProcess) continue;
    
    existingIds.add(sourcePage.id);
    
    // Find matching content file
    const matchingFile = contentFiles.find(file => file.id === sourcePage.id);
    
    if (!matchingFile) {
      // If no matching file, mark for creation
      toCreate.push(sourcePage);
      console.debug(`[Debug] Marking ${sourcePage.title} for creation (no matching file found)`);
    } else {
      // Check if name has changed - this is a rename
      const oldBaseName = path.basename(matchingFile.filepath);
      const newBaseName = sourcePage.outputName;
      
      if (oldBaseName !== newBaseName) {
        console.debug(`[Debug] Detected page rename: "${oldBaseName}" -> "${newBaseName}"`);
        renamedPages.set(sourcePage.id, {
          oldName: oldBaseName,
          newName: newBaseName
        });
      }
      
      // Compare timestamps to detect changes
      const sourceLastEdited = new Date(sourcePage.lastEdited).toISOString();
      const fileLastEdited = matchingFile.lastEdited ? 
                           new Date(matchingFile.lastEdited).toISOString() : 
                           '';
      
      if (fileLastEdited !== sourceLastEdited || oldBaseName !== newBaseName) {
        // If file exists but is outdated or renamed, mark for update
        toUpdate.push(sourcePage);
        const reason = fileLastEdited !== sourceLastEdited ? "different edit times" : "page renamed";
        console.debug(`[Debug] Marking ${sourcePage.title} for update due to ${reason}`);
        if (reason === "different edit times") {
          console.debug(`[Debug] Source last edited: ${sourceLastEdited}, File last edited: ${fileLastEdited}`);
        }
      } else {
        // File is current, mark as unchanged
        unchanged.push(sourcePage);
        console.debug(`[Debug] Marking ${sourcePage.title} as unchanged (matches source)`);
      }
    }
  }
  
  // Second pass: determine what needs to be deleted (files that exist but aren't in source)
  const toDelete = contentFiles.filter(file => !existingIds.has(file.id));
  
  // Log totals for each category
  console.debug(`[Debug] Action totals - Create: ${toCreate.length}, Update: ${toUpdate.length}, Unchanged: ${unchanged.length}, Delete: ${toDelete.length}, Renamed: ${renamedPages.size}`);
  
  return {
    toCreate,
    toUpdate,
    toDelete,
    unchanged,
    renamedPages
  };
}

/**
 * Creates the necessary directories for output files
 */
export function ensureTargetDirectories(actionMap: PageActionMap): void {
  const dirsToCreate = new Set<string>();
  
  // Add directories for pages to be created or updated
  [...actionMap.toCreate, ...actionMap.toUpdate].forEach(page => {
    dirsToCreate.add(`content/${page.targetFolder}`);
  });
  
  // Create all required directories
  dirsToCreate.forEach(dir => {
    fs.ensureDirSync(dir);
  });
}
