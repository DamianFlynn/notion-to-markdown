import { Client } from "@notionhq/client";
import { sleep } from "./helpers";

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  retryableErrors: string[];
}

export const defaultRetryConfig: RetryConfig = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 15000,
  backoffFactor: 2,
  retryableErrors: [
    'notionhq_client_request_timeout', 
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN'
  ]
};

/**
 * Sleep for a specified duration
 */
export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes a Notion API call with retry logic
 */
export async function withRetry<T>(
  apiCall: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const retryConfig: RetryConfig = {
    ...defaultRetryConfig,
    ...config
  };
  
  let retryCount = 0;
  let delayTime = retryConfig.initialDelayMs;
  let lastError: any;
  
  while (true) {
    try {
      return await apiCall();
    } catch (error: any) {
      lastError = error;
      retryCount++;
      
      // Check if this error is retryable
      const shouldRetry = 
        retryConfig.retryableErrors.includes(error.code) || 
        (error.status >= 500 && error.status < 600) ||
        error.status === 429;
      
      // If we've hit our retry limit or it's not a retryable error, throw
      if (!shouldRetry || retryCount >= retryConfig.maxRetries) {
        break;
      }
      
      console.warn(
        `[Warning] API request failed with error code ${error.code || error.status || 'unknown'}. ` +
        `Retrying (${retryCount}/${retryConfig.maxRetries}) in ${delayTime}ms...`
      );
      
      // Wait before retrying
      await delay(delayTime);
      
      // Increase delay using exponential backoff with jitter (±10%)
      const jitter = 0.2 * Math.random() - 0.1; // Value between -0.1 and 0.1
      delayTime = Math.min(
        delayTime * retryConfig.backoffFactor * (1 + jitter),
        retryConfig.maxDelayMs
      );
    }
  }
  
  console.error(`[Error] API request failed after ${retryConfig.maxRetries} retries. Last error:`, lastError);
  throw lastError;
}

/**
 * Creates a wrapper function that retries on failure
 */
export function createRetryableFunction<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config?: Partial<RetryConfig>
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return await withRetry(() => fn(...args), config);
  }) as T;
}

/**
 * Creates a wrapper that always completes (returns null on failure after retries)
 */
export function createFaultTolerantFunction<T extends (...args: any[]) => Promise<any>, R = null>(
  fn: T,
  fallbackValue: R,
  config?: Partial<RetryConfig>
): (...args: Parameters<T>) => Promise<R | Awaited<ReturnType<T>>> {
  return async (...args: Parameters<T>): Promise<R | Awaited<ReturnType<T>>> => {
    try {
      return await withRetry(() => fn(...args), config);
    } catch (error) {
      console.warn(`[Warning] Operation failed after all retries. Using fallback value.`, error);
      return fallbackValue;
    }
  };
}

/**
 * Creates a Notion client with automatic retry functionality
 */
export function createRetryableNotionClient(
  token: string, 
  config: Partial<RetryConfig> = {}
): Client {
  const client = new Client({ auth: token });
  
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      
      if (typeof value !== 'object' || value === null) {
        return value;
      }
      
      // For objects like client.pages, client.blocks, etc.
      return new Proxy(value, {
        get(obj, method) {
          const fn = Reflect.get(obj, method);
          
          if (typeof fn !== 'function') {
            return fn;
          }
          
          // Wrap API methods with retry logic
          return (...args: any[]) => {
            return withRetry(() => fn.apply(obj, args), config);
          };
        }
      });
    }
  });
}
