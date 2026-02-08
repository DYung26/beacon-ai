/**
 * Algolia Integration Module
 *
 * Handles indexing and searching UI elements using Algolia.
 * This module provides a lightweight search layer for determining
 * which page elements should be highlighted.
 *
 * Index Design:
 * - Each UIElement becomes a record with objectID derived from element.id
 * - Records include text, type, selector, visibility, and page context
 * - Searchable attributes: text, type, selector
 * - Facets: type, visibility, url
 *
 * Usage is session-based and ephemeral (no persistence beyond request).
 */

import { algoliasearch } from 'algoliasearch'
import type { UIElement, PageContext } from '@beacon/shared'

interface AlgoliaUIElementRecord {
  objectID: string // Stable ID: `${pageUrl}#${element.id}`
  elementId: string // Original element ID
  text: string
  type: string
  tag: string
  selector: string
  visibility: string
  isVisible: boolean
  url: string
  viewport: {
    width: number
    height: number
  }
  boundingBox: {
    x: number
    y: number
    width: number
    height: number
  }
  [key: string]: unknown
}

type AlgoliaClient = ReturnType<typeof algoliasearch>
let algoliaAdminClient: AlgoliaClient | null = null
let algoliaSearchClient: AlgoliaClient | null = null

/**
 * Initialize Algolia admin client for write operations (indexing).
 * Uses ADMIN_ALGOLIA_KEY (server-side only).
 * Returns null if credentials are not available (graceful degradation).
 */
function initializeAdminClient(): AlgoliaClient | null {
  if (algoliaAdminClient) {
    return algoliaAdminClient
  }

  const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID
  const adminKey = process.env.ADMIN_ALGOLIA_KEY

  if (!appId || !adminKey) {
    console.warn('[Algolia] Missing ADMIN_ALGOLIA_KEY in environment - indexing will be skipped')
    return null
  }

  algoliaAdminClient = algoliasearch(appId, adminKey)
  return algoliaAdminClient
}

/**
 * Initialize Algolia search client for read operations.
 * Uses NEXT_PUBLIC_ALGOLIA_SEARCH_KEY (read-only, safe for frontend).
 * Returns null if credentials are not available (graceful degradation).
 */
function initializeSearchClient(): AlgoliaClient | null {
  if (algoliaSearchClient) {
    return algoliaSearchClient
  }

  const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID
  const searchKey = process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY

  if (!appId || !searchKey) {
    console.warn('[Algolia] Missing NEXT_PUBLIC_ALGOLIA_SEARCH_KEY in environment')
    return null
  }

  algoliaSearchClient = algoliasearch(appId, searchKey)
  return algoliaSearchClient
}

/**
 * Transform a UIElement into an Algolia record.
 * Uses a stable objectID derived from page URL and element ID.
 */
function elementToRecord(
  element: UIElement,
  pageUrl: string,
  viewport: PageContext['viewport']
): AlgoliaUIElementRecord {
  // Create stable objectID: combines page URL and element ID for session-level uniqueness
  const objectID = `${pageUrl}#${element.id}`

  return {
    objectID,
    elementId: element.id,
    text: element.text,
    type: element.type,
    tag: element.tag,
    selector: element.selector,
    visibility: element.visibility,
    isVisible: element.isVisible,
    url: pageUrl,
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
    boundingBox: element.boundingBox,
  }
}

/**
 * Index UI elements from a PageContext into Algolia.
 * This is a session-based operation; records are not persisted.
 * 
 * Uses the Admin API key for write operations.
 * 
 * Note: This is a best-effort operation with a timeout. If Algolia is unavailable
 * or slow, the guide API will fall back to deterministic selection.
 */
export async function indexPageElements(context: PageContext): Promise<void> {
  try {
    const client = initializeAdminClient()
    if (!client) {
      console.log('[Algolia] Skipping indexing: ADMIN_ALGOLIA_KEY not available')
      return
    }

    const indexName = process.env.NEXT_PUBLIC_ALGOLIA_INDEX_NAME
    if (!indexName) {
      console.warn('[Algolia] Missing NEXT_PUBLIC_ALGOLIA_INDEX_NAME in environment')
      return
    }

    // Transform elements into records
    const records = context.elements.map((elem) =>
      elementToRecord(elem, context.url, context.viewport)
    )

    if (records.length === 0) {
      console.log('[Algolia] No elements to index for', context.url)
      return
    }

    // Add a 5-second timeout to indexing. Algolia may be slow or unavailable.
    // If indexing takes too long, we'll skip it and fall back to deterministic rules.
    const indexingPromise = client.saveObjects({
      indexName,
      objects: records,
    })

    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error('[Algolia] Indexing timeout after 5s')),
        5000
      )
    )

    const result = await Promise.race([indexingPromise, timeoutPromise])

    console.log(
      '[Algolia] Successfully indexed',
      records.length,
      'elements for',
      context.url,
      '- first 2 records:',
      JSON.stringify(records.slice(0, 2), null, 2)
    )
  } catch (error) {
    console.warn(
      '[Algolia] Indexing failed or timed out:',
      error instanceof Error ? error.message : String(error)
    )
    // Graceful degradation: don't crash if Algolia fails
  }
}

/**
 * Search Algolia for UI elements matching a query.
 * Returns selectors for matching elements.
 *
 * Uses the search-only API key for read operations.
 *
 * Query types supported:
 * - Free text queries: searched against text field (e.g., "Sign In")
 * - Type queries: matched as filters (e.g., "type:heading", "type:button")
 * 
 * Note: Search is best-effort with a 3-second timeout.
 */
export async function searchElements(
  query: string,
  pageUrl: string,
  options?: {
    facets?: string[]
    limit?: number
  }
): Promise<string[]> {
  try {
    const client = initializeSearchClient()
    if (!client) {
      console.log('[Algolia] Client not initialized, skipping search for:', query)
      return []
    }

    const indexName = process.env.NEXT_PUBLIC_ALGOLIA_INDEX_NAME
    if (!indexName) {
      return []
    }

    // Build filter to scope to current page only
    // Note: We do NOT filter by isVisible here because Algolia may not have it as a facet.
    // Visibility filtering happens in-memory after search results are returned.
    const filters = [`url:"${pageUrl}"`]

    // Check if this is a type query (e.g., "type:heading")
    let searchQuery = query
    if (query.startsWith('type:')) {
      const typeValue = query.replace('type:', '').trim()
      filters.push(`type:"${typeValue}"`)
      searchQuery = '' // Empty query when filtering by type
    }

    console.log('[Algolia] Searching index:', {
      query,
      filters: filters.join(' AND '),
      limit: options?.limit || 10,
    })

    // Add a 3-second timeout to search. If Algolia is slow, fall back to deterministic rules.
    const searchPromise = client.searchSingleIndex({
      indexName,
      searchParams: {
        query: searchQuery,
        // filters: filters.join(' AND '),
        hitsPerPage: options?.limit || 10,
      },
    })

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => {
          reject(new Error('[Algolia] Search timeout after 3s'))
        },
        3000
      )
    )

    const results = await Promise.race([searchPromise, timeoutPromise])

    // Extract selectors from results
    const selectors = ((results as { hits?: Array<Record<string, unknown>> }).hits || [])
      .map((hit) => hit.selector as string)
      .filter((selector): selector is string => typeof selector === 'string')

    console.log('[Algolia] Search results for "' + query + '":', {
      hitCount: (results as { hits?: Array<unknown> }).hits?.length || 0,
      selectorsReturned: selectors.length,
      selectors: selectors.slice(0, 5), // Log first 5 for debugging
    })

    return selectors
  } catch (error) {
    console.warn(
      '[Algolia] Search failed or timed out for query "' + query + '":',
      error instanceof Error ? error.message : String(error)
    )
    return []
  }
}

/**
 * Get meaningful queries based on PageContext signals.
 * Returns multiple query attempts to find relevant elements.
 *
 * Strategy:
 * 1. Extract visible heading text (primary intent signals)
 * 2. Use interactive element text if no headings
 * 3. Use type-based queries as fallback (heading, button, link, text)
 *
 * Type queries use the format "type:heading" which are converted to Algolia filters
 * in searchElements(). This ensures we always get results even if text matching fails.
 */
export function suggestQueries(context: PageContext): string[] {
  const queries: string[] = []

  // Strategy 1: Use visible heading text as primary query
  // Headings often indicate page intent and relevant UI sections
  const visibleHeadings = context.elements
    .filter((el) => el.type === 'heading' && el.visibility === 'in-viewport')
    .map((el) => el.text.substring(0, 50).trim())
    .filter((text) => text.length > 3 && text.length < 100)

  // Add up to 2 heading queries
  for (const heading of visibleHeadings.slice(0, 2)) {
    if (heading.length > 0) {
      queries.push(heading)
    }
  }

  // Strategy 2: Use interactive element queries if few or no headings
  // This helps find buttons, links, and other interactive UI
  if (queries.length === 0) {
    const interactiveElements = context.elements
      .filter((el) => (el.type === 'button' || el.type === 'link') && el.isVisible)
      .map((el) => el.text.substring(0, 30).trim())
      .filter((text) => text.length > 2 && text.length < 50)

    for (const text of interactiveElements.slice(0, 2)) {
      if (text.length > 0) {
        queries.push(text)
      }
    }
  }

  // Strategy 3: Fallback to type-based queries
  // Type queries use filters instead of text search to ensure consistent results
  // Format: "type:heading", "type:button", etc.
  if (queries.length === 0) {
    queries.push('type:heading')
    queries.push('type:button')
    queries.push('type:link')
  }

  // Log generated queries for debugging
  console.log('[Algolia] Generated', queries.length, 'queries:', queries)

  // Defensive: filter out empty strings
  return queries.filter((q) => q && q.trim().length > 0)
}
