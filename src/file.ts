import fs from 'fs-extra';
import path from 'path';
import frontMatter from 'front-matter';
import { ContentFile } from './markdown/types';

/**
 * Define the structure for front matter attributes we expect to find
 */
interface FrontMatterAttributes {
  id?: string;
  NOTION_METADATA?: {
    id?: string;
    [key: string]: any;
  };
  last_edited_time?: string;
  lastmod?: string;
  EXPIRY_TIME?: string;
  UPDATE_TIME?: string;
  [key: string]: any; // Allow for other properties
}

/**
 * Get a content file by filepath
 */
export function getContentFileByPath(filepath: string): ContentFile | null {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const parsed = frontMatter<FrontMatterAttributes>(content);

    return {
      filename: path.basename(filepath),
      filepath,
      metadata: parsed.attributes,
      content: content,
      expiry_time: parsed.attributes.EXPIRY_TIME || null,
      last_updated: parsed.attributes.UPDATE_TIME || undefined
    };
  } catch (error) {
    console.warn(`[Warning] Failed to parse content file ${filepath}: ${error}`);
    return null;
  }
}

/**
 * Get all markdown files in the content directory
 * 
 * @param contentDir - Directory to scan for markdown files
 * @returns Array of content files with parsed front matter
 */
export function getAllContentFiles(contentDir: string = 'content'): ContentFile[] {
  const contentFiles: ContentFile[] = [];
  
  if (!fs.existsSync(contentDir)) {
    return contentFiles;
  }
  
  // Function to recursively scan directories
  function scanDirectory(dir: string) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        // Recursively scan subdirectories
        scanDirectory(filePath);
      } else if (filePath.endsWith('.md')) {
        try {
          // Read the file and parse front matter
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = frontMatter<FrontMatterAttributes>(content);
          
          contentFiles.push({
            filename: file,
            filepath: filePath,
            metadata: parsed.attributes,
            content: content,
            expiry_time: parsed.attributes.EXPIRY_TIME || null,
            last_updated: parsed.attributes.UPDATE_TIME || undefined
          });
        } catch (error) {
          console.warn(`[Warning] Failed to parse front matter in ${filePath}: ${error}`);
        }
      }
    });
  }
  
  scanDirectory(contentDir);
  return contentFiles;
}

/**
 * Get a content file by ID
 * 
 * @param contentDir - Directory to scan for content files
 * @param id - Notion ID to search for
 * @returns Content file if found, null otherwise
 */
export function getContentFile(contentDir: string, id: string): ContentFile | null {
  const contentFiles = getAllContentFiles(contentDir);
  
  return contentFiles.find(file => {
    const fileId = file.metadata?.id || 
                  (file.metadata?.NOTION_METADATA?.id) || 
                  null;
    return fileId === id;
  }) || null;
}

/**
 * Check if a file is a bundle index
 * 
 * @param filepath - File path to check
 * @returns Whether the file is a bundle index
 */
export function isBundleIndex(filepath: string): boolean {
  const fileName = path.basename(filepath);
  return fileName === 'index.md' || fileName === '_index.md';
}

/**
 * Get all files in a bundle directory
 * 
 * @param bundleDirPath - Path to the bundle directory 
 * @returns Array of file paths in the bundle directory
 */
export function getBundleFiles(bundleDirPath: string): string[] {
  if (!fs.existsSync(bundleDirPath)) {
    return [];
  }
  
  try {
    return fs.readdirSync(bundleDirPath)
      .map(file => path.join(bundleDirPath, file))
      .filter(filePath => fs.statSync(filePath).isFile());
  } catch (error) {
    console.error(`[Error] Failed to read bundle directory ${bundleDirPath}: ${error}`);
    return [];
  }
}
