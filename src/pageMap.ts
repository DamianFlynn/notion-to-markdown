import { Client, isFullPage } from "@notionhq/client";
import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import fs from "fs-extra";
import path from "path";
import { DatabaseMount, PageMount } from "./config";
import { getAllContentFiles } from "./file";
import { getPageTitle, getPageShouldBeProcessed } from "./helpers";
import { withRetry } from "./utils";
import { getBundlePath } from './utils/bundle';
import { DEFAULT_HUGO_BUNDLE_CONFIG } from './types/hugo';

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
  isBundle: boolean;
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
      // Handle pagination - In v5 use dataSources.query instead of databases.query
      let hasMore = true;
      let startCursor: string | undefined = undefined;
      
      while (hasMore) {
        const response = await notion.dataSources.query({
          data_source_id: mount.database_id,
          start_cursor: startCursor,
        });
        
        for (const pageItem of response.results) {
          // Type guard for page objects
          if (typeof pageItem !== 'object' || pageItem === null || (pageItem as any).object !== "page") continue;
          
          const pageObj = pageItem as PageObjectResponse;
          const title = getPageTitle(pageObj);
          
          // Get bundle path
          const bundlePath = getBundlePath({
            title,
            pageId: pageObj.id,
            contentType: 'posts',
            targetFolder: mount.target_folder
          });
          
          const shouldProcess = getPageShouldBeProcessed(pageObj);
          
          pageMap.push({
            id: pageObj.id,
            title,
            outputName: bundlePath.indexFileName,
            lastEdited: pageObj.last_edited_time,
            targetFolder: mount.target_folder,
            mountType: 'database',
            mountSource: mount.database_id,
            page: pageObj,
            shouldProcess
          });
        }
        
        hasMore = response.has_more;
        startCursor = response.next_cursor ?? undefined;
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
      
      // Get bundle path
      const bundlePath = getBundlePath({
        title,
        pageId: pageObj.id,
        contentType: 'page',
        targetFolder: mount.target_folder
      });
      
      const shouldProcess = getPageShouldBeProcessed(pageObj);
      
      pageMap.push({
        id: pageObj.id,
        title,
        outputName: bundlePath.indexFileName,
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
 * Updated to support bundle structure
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
    const fileName = path.basename(file.filepath);
    const isBundle = fileName === 'index.md' || fileName === '_index.md';
    
    contentFileMap.push({
      id,
      filepath: file.filepath,
      outputName: path.basename(file.filepath),
      lastEdited: file.metadata.last_edited_time || file.metadata.lastmod || '',
      targetFolder: relativePath || '.',
      isBundle,
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
      // For bundles, check the parent directory name
      let hasStructuralChange = false;
      
      if (matchingFile.isBundle) {
        const currentDir = path.basename(path.dirname(matchingFile.filepath));
        
        // Generate the bundle path to compare
        const bundlePath = getBundlePath({
          title: sourcePage.title,
          pageId: sourcePage.id,
          contentType: sourcePage.mountType === 'database' ? 'posts' : 'page',
          targetFolder: sourcePage.targetFolder
        });
        
        const newDirName = path.basename(bundlePath.bundleDirPath);
        
        if (currentDir !== newDirName) {
          console.debug(`[Debug] Detected bundle directory rename: "${currentDir}" -> "${newDirName}"`);
          renamedPages.set(sourcePage.id, {
            oldName: currentDir,
            newName: newDirName
          });
          hasStructuralChange = true;
        }
      } else {
        // Check if we're converting from flat to bundle structure
        const bundlePath = getBundlePath({
          title: sourcePage.title,
          pageId: sourcePage.id,
          contentType: sourcePage.mountType === 'database' ? 'posts' : 'page',
          targetFolder: sourcePage.targetFolder
        });
        
        if (bundlePath.isBundle) {
          console.debug(`[Debug] Converting from flat file to bundle structure: ${sourcePage.title}`);
          hasStructuralChange = true;
        }
      }
      
      // Compare timestamps to detect changes
      const sourceLastEdited = new Date(sourcePage.lastEdited).toISOString();
      const fileLastEdited = matchingFile.lastEdited ? 
                           new Date(matchingFile.lastEdited).toISOString() : 
                           '';
      
      if (fileLastEdited !== sourceLastEdited || hasStructuralChange) {
        // If file exists but is outdated or structure changed, mark for update
        toUpdate.push(sourcePage);
        const reason = hasStructuralChange ? 
                      "structure changed" : 
                      "different edit times";
        console.debug(`[Debug] Marking ${sourcePage.title} for update due to ${reason}`);
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
    // Get bundle path
    const bundlePath = getBundlePath({
      title: page.title,
      pageId: page.id,
      contentType: page.mountType === 'database' ? 'posts' : 'page',
      targetFolder: page.targetFolder
    });
    
    dirsToCreate.add(bundlePath.bundleDirPath);
  });
  
  // Create all required directories
  dirsToCreate.forEach(dir => {
    fs.ensureDirSync(dir);
  });
}

/**
 * Helper function for pagination with proper typing
 */
async function* iteratePaginatedAPI<T>(method: Function, args: any): AsyncGenerator<T> {
  let hasMore = true;
  let cursor: string | undefined = undefined;
  
  while (hasMore) {
    const response = await withRetry(() => 
      method({
        ...args,
        start_cursor: cursor,
      })
    );
    
    if (!response || typeof response !== 'object') {
      console.warn('[Warning] API returned invalid response');
      return;
    }
    
    // Safely access results - use type assertion to handle the unknown response type
    const responseObj = response as { 
      results?: unknown[],
      has_more?: boolean,
      next_cursor?: string
    };
    
    // Fixed: Don't reference results in its own initialization
    const resultsArray = Array.isArray(responseObj.results) ? responseObj.results : [];
    for (const item of resultsArray) {
      yield item as T;
    }
    
    // Safely check has_more property
    hasMore = responseObj.has_more === true;
    cursor = typeof responseObj.next_cursor === 'string' ? responseObj.next_cursor : undefined;
  }
}
