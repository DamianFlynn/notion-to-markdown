import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';

// Define structure for essential tracking information
interface ImageTrackingInfo {
  localPath: string;     // Path relative to project root
  contentHash?: string;  // Hash of the content for detecting actual changes
  lastFetched: string;   // ISO timestamp of when the image was last fetched
}

// Minimal tracking map - only for data we can't encode in the filename
interface ImageTrackingMap {
  [imageId: string]: ImageTrackingInfo;
}

// Image directory constant
export const IMAGE_DIR = 'static/images';
const TRACKING_FILE = `${IMAGE_DIR}/.metadata.json`;

/**
 * Parse metadata from a filename
 * Format: notion-{pagePrefix}-{contentId}-{timestamp}.{ext}
 */
export function parseFilenameMetadata(filename: string): {
  pageIdPrefix?: string;
  contentId?: string;
  timestamp?: Date;
  extension?: string;
} {
  // Expected format: notion-{pagePrefix}-{contentId}-{timestamp}.{ext}
  const regex = /notion-([a-f0-9]{8})-([a-f0-9]{8})-(\d+)\.([a-zA-Z0-9]+)$/;
  const match = filename.match(regex);
  
  if (!match) return {};
  
  const [, pageIdPrefix, contentId, timestamp, extension] = match;
  
  return {
    pageIdPrefix,
    contentId,
    timestamp: new Date(parseInt(timestamp) * 1000), // Convert from unix timestamp
    extension
  };
}

/**
 * Generate a filename that encodes important metadata
 */
export function generateImageFilename(url: string, pageId: string): string {
  // Extract extension from URL or default to jpg
  let extension = 'jpg';
  try {
    const urlPath = new URL(url).pathname;
    const extMatch = urlPath.match(/\.([a-zA-Z0-9]{1,5})(?:\?|$)/);
    if (extMatch && extMatch[1]) {
      extension = extMatch[1].toLowerCase();
    }
  } catch (e) {
    // Use default extension on error
  }
  
  // Create content hash from URL to ensure unique but consistent filenames
  const contentId = generateContentId(url).substring(0, 8);
  
  // Use page ID as part of the filename for organization
  const pageIdPrefix = pageId.replace(/-/g, '').substring(0, 8);
  
  // Add current timestamp (unix seconds) to track when this version was created
  const timestamp = Math.floor(Date.now() / 1000);
  
  return `notion-${pageIdPrefix}-${contentId}-${timestamp}.${extension}`;
}

/**
 * Generate a content ID based on the core parts of the URL (ignoring auth tokens)
 */
export function generateContentId(url: string): string {
  try {
    const parsedUrl = new URL(url);
    
    // Extract the key parts that identify the actual content
    const contentParts = [
      parsedUrl.pathname,
      // Take only content-related query params, ignore auth tokens
      ...Array.from(parsedUrl.searchParams.entries())
        .filter(([key]) => !key.includes('X-Amz-'))
        .map(([k, v]) => `${k}=${v}`)
    ];
    
    return crypto.createHash('md5').update(contentParts.join('|')).digest('hex');
  } catch (e) {
    // Fallback to full URL hash if parsing fails
    return crypto.createHash('md5').update(url).digest('hex');
  }
}

/**
 * Load the minimal image tracking database
 */
export function loadImageTrackingDb(): ImageTrackingMap {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      const data = fs.readFileSync(TRACKING_FILE, 'utf-8');
      return JSON.parse(data) as ImageTrackingMap;
    }
  } catch (error) {
    console.warn(`[Warning] Failed to load image tracking database: ${error}`);
  }
  
  return {};
}

/**
 * Save the minimal image tracking database
 */
export function saveImageTrackingDb(trackingDb: ImageTrackingMap): void {
  try {
    fs.ensureDirSync(path.dirname(TRACKING_FILE));
    fs.writeFileSync(TRACKING_FILE, JSON.stringify(trackingDb, null, 2));
  } catch (error) {
    console.error(`[Error] Failed to save image tracking database: ${error}`);
  }
}

/**
 * Get existing image files for a page from filesystem
 */
export function findExistingImagesForPage(pageId: string): string[] {
  const imageDir = path.join(process.cwd(), IMAGE_DIR);
  const pageIdPrefix = pageId.replace(/-/g, '').substring(0, 8);
  const pattern = `notion-${pageIdPrefix}-`;
  
  try {
    if (!fs.existsSync(imageDir)) {
      return [];
    }
    
    return fs.readdirSync(imageDir)
      .filter(file => file.startsWith(pattern) && !file.startsWith('.'))
      .map(file => path.join(IMAGE_DIR, file));
  } catch (error) {
    console.error(`[Error] Failed to read image directory: ${error}`);
    return [];
  }
}

/**
 * Find the most recent image file matching a specific content ID
 */
export function findLatestImageByContentId(contentId: string, pageId: string): string | null {
  const pageImages = findExistingImagesForPage(pageId);
  const shortContentId = contentId.substring(0, 8);
  
  // Find all matching images with this content ID
  const matchingImages = pageImages.filter(imagePath => {
    const filename = path.basename(imagePath);
    return filename.includes(`-${shortContentId}-`);
  });
  
  if (matchingImages.length === 0) {
    return null;
  }
  
  // Sort by timestamp (newest first) and return the most recent
  matchingImages.sort((a, b) => {
    const filenameA = path.basename(a);
    const filenameB = path.basename(b);
    const metaA = parseFilenameMetadata(filenameA);
    const metaB = parseFilenameMetadata(filenameB);
    
    // If we can't parse the timestamp, consider B newer
    if (!metaA.timestamp) return 1;
    if (!metaB.timestamp) return -1;
    
    // Newer timestamps (larger values) should come first
    return metaB.timestamp.getTime() - metaA.timestamp.getTime();
  });
  
  return matchingImages[0];
}

/**
 * Calculate hash of a file's content
 */
export function calculateFileHash(filePath: string): string {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(fileBuffer).digest('hex');
  } catch (error) {
    console.warn(`[Warning] Failed to calculate hash for ${filePath}: ${error}`);
    return '';
  }
}

/**
 * Check if an image needs to be fetched
 */
export function shouldFetchImage(url: string, pageId: string): boolean {
  // Generate a unique content ID for this image URL
  const contentId = generateContentId(url);
  
  // Check if we have a recent version of this image
  const latestImage = findLatestImageByContentId(contentId, pageId);
  
  if (!latestImage) {
    return true; // No existing image found, must fetch
  }
  
  // Check if the image file actually exists
  if (!fs.existsSync(path.join(process.cwd(), latestImage))) {
    return true; // File is missing, must fetch
  }
  
  // File exists and matches content ID, no need to fetch
  return false;
}

/**
 * Track image in the minimal DB
 */
export function trackImage(contentId: string, localPath: string): void {
  const trackingDb = loadImageTrackingDb();
  const fullLocalPath = path.join(process.cwd(), localPath);
  
  // Calculate content hash for the downloaded file
  const contentHash = fs.existsSync(fullLocalPath) ? 
    calculateFileHash(fullLocalPath) : undefined;
  
  trackingDb[contentId] = {
    localPath,
    lastFetched: new Date().toISOString(),
    contentHash
  };
  
  saveImageTrackingDb(trackingDb);
}

/**
 * Get a mapping of content IDs to local image paths for a page
 */
export function getPageImages(pageId: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pageImages = findExistingImagesForPage(pageId);
  
  for (const imagePath of pageImages) {
    const filename = path.basename(imagePath);
    const metadata = parseFilenameMetadata(filename);
    
    if (metadata.contentId) {
      // Convert to web path format
      const webPath = `/${imagePath}`.replace(/\\/g, '/');
      result[metadata.contentId] = webPath;
    }
  }
  
  return result;
}

/**
 * Clean up orphaned images that are no longer referenced by any page
 */
export function cleanupOrphanedImages(activePageIds: string[]): number {
  const imageDir = path.join(process.cwd(), IMAGE_DIR);
  
  if (!fs.existsSync(imageDir)) {
    return 0;
  }
  
  try {
    // Get all image files in the directory
    const allImages = fs.readdirSync(imageDir)
      .filter(file => !file.startsWith('.') && file.startsWith('notion-'));
    
    // Create a set of active page ID prefixes
    const activePrefixes = new Set(
      activePageIds.map(id => id.replace(/-/g, '').substring(0, 8))
    );
    
    // Find orphaned images
    const orphaned = allImages.filter(file => {
      // Extract the page ID prefix from the filename (notion-{pagePrefix}-{contentId}-{timestamp}.{ext})
      const match = file.match(/^notion-([a-f0-9]{8})-/);
      if (!match) return false;
      
      const pagePrefix = match[1];
      return !activePrefixes.has(pagePrefix);
    });
    
    // Delete orphaned images
    let deletedCount = 0;
    for (const file of orphaned) {
      const filePath = path.join(imageDir, file);
      console.debug(`[Debug] Removing orphaned image: ${filePath}`);
      fs.unlinkSync(filePath);
      deletedCount++;
    }
    
    if (deletedCount > 0) {
      console.info(`[Info] Cleaned up ${deletedCount} orphaned images`);
    }
    
    return deletedCount;
  } catch (error) {
    console.error(`[Error] Failed to clean up orphaned images: ${error}`);
    return 0;
  }
}

/**
 * Find image files that don't belong to any of the active pages
 */
export function findOrphanedImages(activePageIds: string[]): string[] {
  const imageDir = path.join(process.cwd(), IMAGE_DIR);
  
  if (!fs.existsSync(imageDir)) {
    return [];
  }
  
  try {
    // Get all image files in the directory
    const allImages = fs.readdirSync(imageDir)
      .filter(file => !file.startsWith('.') && file.startsWith('notion-'));
    
    // Create a set of active page ID prefixes
    const activePrefixes = new Set(
      activePageIds.map(id => id.replace(/-/g, '').substring(0, 8))
    );
    
    // Find orphaned images
    return allImages.filter(file => {
      // Extract the page ID prefix from the filename
      const match = file.match(/^notion-([a-f0-9]{8})-/);
      if (!match) return false;
      
      const pagePrefix = match[1];
      return !activePrefixes.has(pagePrefix);
    }).map(file => path.join(imageDir, file));
  } catch (error) {
    console.error(`[Error] Failed to find orphaned images: ${error}`);
    return [];
  }
}

/**
 * Find and clean up orphaned images when a page is renamed
 * @param oldPageId - The ID of the page that was renamed
 * @param newFilename - The new filename for the renamed page
 */
export function cleanupImagesForRenamedPage(oldPageId: string, newFilename: string): void {
  const pageIdPrefix = oldPageId.replace(/-/g, '').substring(0, 8);
  const imageDir = path.join(process.cwd(), IMAGE_DIR);
  
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
    
    // In this case, we might want to rename the images instead of deleting them
    // This keeps the existing content but ensures it's properly associated with the new page name
    
    // For now, we'll log the images so you can see what would be affected
    if (orphanedImages.length > 0) {
      console.info(`[Info] Found ${orphanedImages.length} images for renamed page ${oldPageId} -> ${newFilename}`);
      
      for (const image of orphanedImages) {
        // Future enhancement: Could rename these images to match the new page name pattern
        // For now, just log them to help with debugging
        console.info(`[Info] Image associated with renamed page: ${image}`);
      }
    }
  } catch (error) {
    console.error(`[Error] Failed to clean up images for renamed page ${oldPageId}: ${error}`);
  }
}
