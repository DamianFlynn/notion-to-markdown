/**
 * Helper functions to ensure consistent render call patterns
 * 
 * This file provides utility functions to standardize how rendering
 * functions are called throughout the codebase, preventing the common
 * error pattern of passing a Client directly to renderPage functions
 */

import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { Client } from "@notionhq/client";
import { renderPage, renderPageSimple } from "./render";
import { PropertyMap } from "./types";

/**
 * Safely get content from a page using simplified rendering
 */
export async function getPageContent(
  page: PageObjectResponse, 
  notion: Client
): Promise<string> {
  const result = await renderPageSimple(page, notion);
  return result.content;
}

/**
 * Safely get both content and title from a page using simplified rendering
 */
export async function getPageContentAndTitle(
  page: PageObjectResponse, 
  notion: Client
): Promise<{ content: string, title: string }> {
  return await renderPageSimple(page, notion);
}

/**
 * Safely get content from a page with custom property mapping
 */
export async function getPageContentWithMapping(
  page: PageObjectResponse, 
  propertyMap: PropertyMap,
  notion: Client
): Promise<string> {
  const result = await renderPage(page, propertyMap, { notion });
  return result.content;
}
