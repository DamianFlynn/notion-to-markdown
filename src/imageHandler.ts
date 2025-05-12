import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { URL } from 'url';
import { 
  IMAGE_DIR,
  generateImageFilename,
  generateContentId,
  shouldFetchImage, 
  trackImage,
  findLatestImageByContentId 
} from './imageTracker';

interface ImageInfo {
  originalUrl: string;
  localPath: string;
  filename: string;
  shouldDownload: boolean;
  contentId: string;
}

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

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
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
 * Process markdown content to replace all Notion image URLs with local ones
 */
export async function processImagesInMarkdown(
  markdownContent: string, 
  pageId: string
): Promise<{ content: string, downloadTasks: Promise<void>[] }> {
  // Regular expressions to find image links in markdown and HTML
  const markdownImageRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  const htmlImageRegex = /<img.*?src=["'](https?:\/\/[^\s"']+)["'].*?>/g;
  const downloadTasks: Promise<void>[] = [];
  
  // Helper function for processing any found image
  const processImage = async (url: string): Promise<string> => {
    try {
      const imageInfo = await processNotionImage(url, pageId);
      
      // Queue the download if needed
      if (imageInfo.shouldDownload) {
        const targetPath = path.join(process.cwd(), IMAGE_DIR, imageInfo.filename);
        const downloadTask = downloadImage(url, targetPath, imageInfo.contentId)
          .catch(err => console.error(`[Error] Failed to download image ${imageInfo.filename}:`, err));
        
        downloadTasks.push(downloadTask);
      }
      
      // Replace the original URL with the local path
      return imageInfo.localPath;
    } catch (error) {
      console.warn(`[Warning] Failed to process image ${url}:`, error);
      return url; // Keep original URL on error
    }
  };

  // Replace all markdown image URLs
  let newContent = await replaceAsync(markdownContent, markdownImageRegex, async (match, url) => {
    const localUrl = await processImage(url);
    return match.replace(url, localUrl);
  });
  
  // Replace all HTML image URLs too
  newContent = await replaceAsync(newContent, htmlImageRegex, async (match, url) => {
    const localUrl = await processImage(url);
    return match.replace(url, localUrl);
  });
  
  return { content: newContent, downloadTasks };
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
