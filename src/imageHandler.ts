import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { URL } from 'url';
import { 
  IMAGE_DIR,
  generateContentId,
  shouldFetchImage, 
  trackImage,
  findLatestImageByContentId 
} from './imageTracker';
import { BundlePath } from './utils/bundle';
import crypto from 'crypto';

interface ImageInfo {
  originalUrl: string;
  localPath: string;
  filename: string;
  shouldDownload: boolean;
  contentId: string;
}

interface ImageProcessingResult {
  content: string;
  downloadTasks: Promise<void>[];
}

/**
 * Track images that have been downloaded in the current session
 */
const downloadedImages = new Set<string>();

/**
 * Check if a URL is from a Notion CDN
 */
function isNotionHostedUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.includes('amazonaws.com') || 
           parsedUrl.hostname.includes('notion.so') ||
           parsedUrl.hostname.includes('notion.site') ||
           parsedUrl.searchParams.has('X-Amz-Credential') ||
           parsedUrl.searchParams.has('X-Amz-Signature');
  } catch (e) {
    return false;
  }
}

/**
 * Process a Notion image URL, downloading it if needed
 */
export async function processNotionImage(
  imageUrl: string, 
  pageId: string
): Promise<ImageInfo> {
  // Skip processing for non-Notion URLs (external references)
  if (!isNotionHostedUrl(imageUrl)) {
    return {
      originalUrl: imageUrl,
      localPath: imageUrl,
      filename: '',
      shouldDownload: false,
      contentId: ''
    };
  }

  // Generate a content ID for this image
  const contentId = generateContentId(imageUrl);
  
  // Check if we need to download this image
  const needsUpdate = shouldFetchImage(imageUrl, pageId);
  
  // Check if we already have this image
  const existingImage = findLatestImageByContentId(contentId, pageId);
  if (!needsUpdate && existingImage) {
    // We have a good version - use it
    const relativePath = `/${existingImage.replace(/\\/g, '/')}`;
    return {
      originalUrl: imageUrl,
      localPath: relativePath,
      filename: path.basename(existingImage),
      shouldDownload: false,
      contentId
    };
  }

  // Generate a new filename with encoded metadata
  const filename = generateImageFilename(imageUrl, pageId);
  
  // Create the target directory if it doesn't exist
  const targetDir = path.join(process.cwd(), IMAGE_DIR);
  fs.ensureDirSync(targetDir);
  
  // Full path to the image
  const imagePath = path.join(targetDir, filename);
  const relativeImagePath = `/${IMAGE_DIR}/${filename}`.replace(/\\/g, '/');
  
  return {
    originalUrl: imageUrl,
    localPath: relativeImagePath,
    filename,
    shouldDownload: true,
    contentId
  };
}

/**
 * Download an image from a URL
 */
export async function downloadImage(imageUrl: string, filePath: string, contentId: string): Promise<void> {
  try {
    console.debug(`[Debug] Downloading image from ${imageUrl} to ${filePath}`);
    
    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'stream',
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    // Create a write stream and pipe the response data
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', reject);
    });
    
    // Track this image in our minimal database
    const relativeImagePath = `/${IMAGE_DIR}/${path.basename(filePath)}`.replace(/\\/g, '/');
    trackImage(contentId, relativeImagePath);
    
    console.info(`[Info] Downloaded image: ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`[Error] Failed to download image from ${imageUrl}:`, error);
    throw error;
  }
}

/**
 * Process images in markdown content and update paths for bundle structure
 * 
 * @param markdown - Original markdown content
 * @param pageId - ID of the Notion page
 * @param bundlePath - Path information for the bundle
 * @returns Updated markdown and download tasks
 */
export async function processImagesInMarkdown(
  markdown: string, 
  pageId: string,
  bundlePath: BundlePath
): Promise<ImageProcessingResult> {
  const downloadTasks: Promise<void>[] = [];
  let updatedContent = markdown;
  
  // Regular expression to find images in markdown
  const imageRegex = /!\[(.*?)\]\((https:\/\/[^\s\)]+)\)/g;
  let match;
  
  while ((match = imageRegex.exec(markdown)) !== null) {
    const [fullMatch, altText, imageUrl] = match;
    
    // Generate image filename
    const imageFileName = generateImageFilename(imageUrl, pageId);
    
    // Create image path based on bundle structure
    const imagePath = path.join(bundlePath.bundleDirPath, imageFileName);
    
    // Create relative path for markdown
    let imageRelativePath = imageFileName;
    if (!bundlePath.isBundle) {
      // For flat structure, use path relative to content
      imageRelativePath = path.join('/images', imageFileName);
    }
    
    // Replace the image URL in the markdown
    updatedContent = updatedContent.replace(
      fullMatch, 
      `![${altText}](${imageRelativePath})`
    );
    
    // Don't download if already processed
    if (downloadedImages.has(imageUrl)) {
      continue;
    }
    
    // Add download task
    downloadTasks.push(
      downloadImage(imageUrl, imagePath, pageId)
        .then(() => {
          downloadedImages.add(imageUrl);
          console.debug(`[Debug] Downloaded image: ${imageUrl} to ${imagePath}`);
        })
        .catch(error => {
          console.error(`[Error] Failed to download image ${imageUrl}: ${error.message}`);
        })
    );
  }
  
  return {
    content: updatedContent,
    downloadTasks
  };
}

/**
 * Generate a consistent filename for an image based on its URL and a content ID
 * 
 * @param imageUrl - URL of the image
 * @param contentId - ID of the page or content the image belongs to
 * @returns A consistent filename for the image
 */
function generateImageFilename(imageUrl: string, contentId: string): string {
  // Extract original filename from URL if possible
  let originalFilename = '';
  try {
    originalFilename = path.basename(new URL(imageUrl).pathname);
    // Remove query parameters if present
    originalFilename = originalFilename.split('?')[0];
  } catch (e) {
    // URL parsing failed, use a hash of the URL
    originalFilename = '';
  }

  // If we couldn't extract a meaningful filename, generate a hash
  if (!originalFilename || originalFilename.length < 3) {
    // Create a hash from the URL for consistent naming
    const hash = crypto.createHash('md5').update(imageUrl).digest('hex').substring(0, 8);
    const ext = guessImageExtension(imageUrl);
    originalFilename = `image-${hash}${ext}`;
  }

  // Add content ID prefix for organization
  const prefix = contentId.replace(/-/g, '').substring(0, 8);
  return `img-${prefix}-${originalFilename}`;
}

/**
 * Guess the image extension based on URL or content type
 */
function guessImageExtension(url: string): string {
  const extensionMatch = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  if (extensionMatch && ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(extensionMatch[1].toLowerCase())) {
    return `.${extensionMatch[1].toLowerCase()}`;
  }
  
  // Default extension if we can't determine it
  return '.png';
}

/**
 * Process Notion block with image
 * 
 * @param block - Notion block containing an image
 * @param pageId - ID of the page
 * @param bundlePath - Path information for the bundle
 * @returns Markdown representation of the image
 */
export async function processImageBlock(block: any, pageId: string, bundlePath: BundlePath): Promise<string> {
  if (!block.image) {
    return '';
  }
  
  const imageUrl = block.image.file?.url || block.image.external?.url;
  if (!imageUrl) {
    return '';
  }
  
  // Generate image filename
  const imageFileName = generateImageFilename(imageUrl, pageId);
  
  // Create image path based on bundle structure
  const imagePath = path.join(bundlePath.bundleDirPath, imageFileName);
  
  // Create relative path for markdown
  let imageRelativePath = imageFileName;
  if (!bundlePath.isBundle) {
    // For flat structure, use path relative to content
    imageRelativePath = path.join('/images', imageFileName);
  }
  
  // Get caption if available
  const caption = block.image.caption
    ? block.image.caption.map((richText: any) => richText.plain_text).join('')
    : 'Image';
  
  // Download image if not already processed
  if (!downloadedImages.has(imageUrl)) {
    try {
      await downloadImage(imageUrl, imagePath, pageId);
      downloadedImages.add(imageUrl);
      console.debug(`[Debug] Downloaded image block: ${imageUrl} to ${imagePath}`);
    } catch (error) {
      console.error(`[Error] Failed to download image block ${imageUrl}:`, error);
    }
  }
  
  // Return markdown for image
  return `![${caption}](${imageRelativePath})\n\n`;
}

/**
 * Get a map of image paths for a Notion page
 */
export async function getPageImages(pageId: string): Promise<Map<string, string>> {
  // This is a placeholder for actual implementation
  return new Map();
}

/**
 * Helper function for asynchronous regex replacement
 */
async function replaceAsync(
  str: string, 
  regex: RegExp, 
  asyncFn: (match: string, ...args: any[]) => Promise<string>
): Promise<string> {
  const matches = Array.from(str.matchAll(new RegExp(regex, 'g')));
  const promises = matches.map(match => 
    asyncFn(match[0], ...match.slice(1))
  );
  
  const replacements = await Promise.all(promises);
  
  let result = str;
  let offset = 0;
  
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const replacement = replacements[i];
    
    const startIndex = match.index! + offset;
    const endIndex = startIndex + match[0].length;
    
    result = result.substring(0, startIndex) + 
             replacement + 
             result.substring(endIndex);
             
    // Adjust offset for subsequent replacements
    offset += replacement.length - match[0].length;
  }
  
  return result;
}
