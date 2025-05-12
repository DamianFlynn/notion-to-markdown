import fs from "fs-extra";
import path from "path";
import frontMatter from "front-matter";

export interface ContentFile {
  filepath: string;
  content: string;
  metadata: any;
  expiry_time: string | null;
}

/**
 * Extracts Notion page ID from filename
 */
export function extractNotionIdFromFilename(filename: string): string | null {
  // Looking for pattern like "page-name-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.md"
  const match = filename.match(/[-_]([a-f0-9]{32})\.md$/i);
  if (match && match[1]) {
    // Insert hyphens to format as a proper Notion ID
    const id = match[1];
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  }
  return null;
}

export function getContentFile(filepath: string): ContentFile | null {
  try {
    if (!fs.existsSync(filepath)) return null;
    
    const content = fs.readFileSync(filepath, "utf-8");
    const parsed = frontMatter(content);
    const metadata = parsed.attributes as any;
    
    // Check for ID in different locations with fallbacks
    if (!metadata.id) {
      // First check NOTION_METADATA
      if (metadata.NOTION_METADATA && metadata.NOTION_METADATA.id) {
        metadata.id = metadata.NOTION_METADATA.id;
      } else {
        // Try to extract from filename
        const extractedId = extractNotionIdFromFilename(path.basename(filepath));
        if (extractedId) {
          metadata.id = extractedId;
          console.debug(`[Debug] Extracted ID ${extractedId} from filename ${path.basename(filepath)}`);
        }
      }
    }
    
    return {
      filepath,
      content,
      metadata,
      expiry_time: metadata.EXPIRY_TIME || null,
    };
  } catch (e) {
    console.warn(`[Warning] Failed to parse file ${filepath}: ${e}`);
    return null;
  }
}

export function getAllContentFiles(basePath: string): ContentFile[] {
  const results: ContentFile[] = [];
  
  function scanDirectory(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      return;
    }
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const contentFile = getContentFile(fullPath);
        if (contentFile) {
          if (contentFile.metadata && contentFile.metadata.id) {
            console.debug(`[Debug] Found file: ${fullPath} with ID: ${contentFile.metadata.id}`);
            results.push(contentFile);
          } else {
            console.warn(`[Warning] Skipped file with missing ID: ${fullPath}`);
          }
        }
      }
    }
  }
  
  scanDirectory(basePath);
  console.info(`[Info] Found ${results.length} markdown files in ${basePath}`);
  return results;
}

/**
 * Deletes a content file from disk
 */
export function deleteContentFile(filepath: string): void {
  try {
    if (fs.existsSync(filepath)) {
      console.info(`[Info] Deleting content file: ${filepath}`);
      fs.unlinkSync(filepath);
    }
  } catch (error) {
    console.error(`[Error] Failed to delete content file ${filepath}: ${error}`);
  }
}

/**
 * Find all content files that match a specific page ID pattern
 */
export function findContentFilesByPageId(contentBasePath: string, pageId: string): string[] {
  try {
    if (!fs.existsSync(contentBasePath)) {
      return [];
    }
    
    const allFiles = getAllContentFiles(contentBasePath);
    const result = allFiles.filter(file => 
      file.filepath.includes(pageId) || 
      (file.metadata?.id === pageId) || 
      (file.metadata?.NOTION_METADATA?.id === pageId)
    );
    
    return result.map(file => file.filepath);
  } catch (error) {
    console.error(`[Error] Failed to find content files for page ${pageId}: ${error}`);
    return [];
  }
}
