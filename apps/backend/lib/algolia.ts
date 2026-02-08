import { algoliasearch } from 'algoliasearch'
import type { UIElement, PageContext } from '@beacon/shared'

interface AlgoliaUIElementRecord {
  objectID: string
  elementId: string
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
 * Uses stable objectID: `${pageUrl}#${element.id}` for session-level uniqueness.
 */
function elementToRecord(
  element: UIElement,
  pageUrl: string,
  viewport: PageContext['viewport']
): AlgoliaUIElementRecord {
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
 * Session-based operation with timeout fallback to deterministic selection.
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

    const records = context.elements.map((elem) =>
      elementToRecord(elem, context.url, context.viewport)
    )

    if (records.length === 0) {
      console.log('[Algolia] No elements to index for', context.url)
      return
    }

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

    await Promise.race([indexingPromise, timeoutPromise])

    console.log(
      '[Algolia] Successfully indexed',
      records.length,
      'elements for',
      context.url
    )
  } catch (error) {
    console.warn(
      '[Algolia] Indexing failed or timed out:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

/**
 * Search Algolia for UI elements matching a query.
 * Best-effort operation with 3-second timeout; returns selectors for matches.
 * Supports free-text queries and type-based filter queries (e.g., "type:heading").
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

    const filters = [`url:"${pageUrl}"`]

    let searchQuery = query
    if (query.startsWith('type:')) {
      const typeValue = query.replace('type:', '').trim()
      filters.push(`type:"${typeValue}"`)
      searchQuery = ''
    }

    console.log('[Algolia] Searching index:', {
      query,
      filters: filters.join(' AND '),
      limit: options?.limit || 10,
    })

    const searchPromise = client.searchSingleIndex({
      indexName,
      searchParams: {
        query: searchQuery,
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

    const selectors = ((results as { hits?: Array<Record<string, unknown>> }).hits || [])
      .map((hit) => hit.selector as string)
      .filter((selector): selector is string => typeof selector === 'string')

    console.log('[Algolia] Search results for "' + query + '":', {
      hitCount: (results as { hits?: Array<unknown> }).hits?.length || 0,
      selectorsReturned: selectors.length,
      selectors: selectors.slice(0, 5),
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
 * Generate meaningful queries based on PageContext signals.
 * Returns multiple query attempts to find relevant elements.
 * Strategy: visible headings → interactive elements → type-based fallback.
 */
export function suggestQueries(context: PageContext): string[] {
  const queries: string[] = []

  const visibleHeadings = context.elements
    .filter((el) => el.type === 'heading' && el.visibility === 'in-viewport')
    .map((el) => el.text.substring(0, 50).trim())
    .filter((text) => text.length > 3 && text.length < 100)

  for (const heading of visibleHeadings.slice(0, 2)) {
    if (heading.length > 0) {
      queries.push(heading)
    }
  }

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

  if (queries.length === 0) {
    queries.push('type:heading')
    queries.push('type:button')
    queries.push('type:link')
  }

  console.log('[Algolia] Generated', queries.length, 'queries:', queries)

  return queries.filter((q) => q && q.trim().length > 0)
}
