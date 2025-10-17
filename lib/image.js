/**
 * Image transformation utility for Supabase Storage CDN
 * Provides zero-cost thumbnailing via Supabase's built-in image transformations
 */

/**
 * Generate a thumbnail URL with Supabase CDN transformations
 * @param {string} url - Original image URL
 * @param {number} w - Width (default: 640)
 * @param {number} q - Quality (default: 70)
 * @returns {string} Transformed URL or original URL if not a Supabase Storage URL
 */
export function thumb(url, w = 640, q = 70) {
  if (!url) return url;
  
  if (url.includes('/object/public/')) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}width=${w}&quality=${q}&resize=contain`;
  }
  
  return url;
}
