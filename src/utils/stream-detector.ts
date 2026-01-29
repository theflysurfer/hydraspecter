/**
 * Stream Detection and Parsing Utilities
 *
 * Detects HLS (.m3u8) and DASH (.mpd) streaming manifests,
 * parses quality variants, and generates download commands.
 */

import { StreamType, StreamVariant, AudioTrack, SubtitleTrack } from '../types.js';

// Patterns for detecting stream manifests
const HLS_PATTERN = /\.m3u8(\?|$)/i;
const DASH_PATTERN = /\.mpd(\?|$)/i;

// DRM detection patterns
const DRM_PATTERNS = {
  widevine: /widevine|com\.widevine/i,
  playready: /playready|com\.microsoft\.playready/i,
  fairplay: /fairplay|com\.apple\.fps/i,
};

/**
 * Detect if a URL is a streaming manifest
 */
export function isStreamManifest(url: string): StreamType | null {
  if (HLS_PATTERN.test(url)) return 'hls';
  if (DASH_PATTERN.test(url)) return 'dash';
  return null;
}

/**
 * Parse an HLS M3U8 master playlist to extract variants
 *
 * @param content The M3U8 playlist content
 * @param baseUrl The base URL for resolving relative paths
 */
export function parseM3U8Manifest(content: string, baseUrl: string): {
  variants: StreamVariant[];
  audioTracks: AudioTrack[];
  subtitles: SubtitleTrack[];
  hasDrm: boolean;
  drmSystem?: string;
} {
  const variants: StreamVariant[] = [];
  const audioTracks: AudioTrack[] = [];
  const subtitles: SubtitleTrack[] = [];
  let hasDrm = false;
  let drmSystem: string | undefined;

  const lines = content.split('\n');

  // Check for DRM
  for (const line of lines) {
    if (line.includes('#EXT-X-KEY') || line.includes('#EXT-X-SESSION-KEY')) {
      for (const [system, pattern] of Object.entries(DRM_PATTERNS)) {
        if (pattern.test(line)) {
          hasDrm = true;
          drmSystem = system;
          break;
        }
      }
    }
  }

  // Parse stream variants (#EXT-X-STREAM-INF)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const nextLine = lines[i + 1]?.trim();
      if (!nextLine || nextLine.startsWith('#')) continue;

      const variant: StreamVariant = {
        url: resolveUrl(nextLine, baseUrl),
        bandwidth: 0,
      };

      // Parse BANDWIDTH
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
      if (bandwidthMatch?.[1]) {
        variant.bandwidth = parseInt(bandwidthMatch[1], 10);
      }

      // Parse RESOLUTION
      const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
      if (resolutionMatch?.[1]) {
        variant.resolution = resolutionMatch[1];
      }

      // Parse CODECS
      const codecsMatch = line.match(/CODECS="([^"]+)"/);
      if (codecsMatch?.[1]) {
        variant.codecs = codecsMatch[1];
      }

      // Parse FRAME-RATE
      const frameRateMatch = line.match(/FRAME-RATE=([\d.]+)/);
      if (frameRateMatch?.[1]) {
        variant.frameRate = parseFloat(frameRateMatch[1]);
      }

      variants.push(variant);
    }

    // Parse audio tracks (#EXT-X-MEDIA:TYPE=AUDIO)
    if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
      const audio: AudioTrack = {
        language: 'und',
      };

      const langMatch = line.match(/LANGUAGE="([^"]+)"/);
      if (langMatch?.[1]) audio.language = langMatch[1];

      const nameMatch = line.match(/NAME="([^"]+)"/);
      if (nameMatch?.[1]) audio.name = nameMatch[1];

      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch?.[1]) audio.url = resolveUrl(uriMatch[1], baseUrl);

      audio.default = line.includes('DEFAULT=YES');

      audioTracks.push(audio);
    }

    // Parse subtitles (#EXT-X-MEDIA:TYPE=SUBTITLES)
    if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=SUBTITLES')) {
      const subtitle: SubtitleTrack = {
        language: 'und',
      };

      const langMatch = line.match(/LANGUAGE="([^"]+)"/);
      if (langMatch?.[1]) subtitle.language = langMatch[1];

      const nameMatch = line.match(/NAME="([^"]+)"/);
      if (nameMatch?.[1]) subtitle.name = nameMatch[1];

      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch?.[1]) subtitle.url = resolveUrl(uriMatch[1], baseUrl);

      subtitle.forced = line.includes('FORCED=YES');

      subtitles.push(subtitle);
    }
  }

  return { variants, audioTracks, subtitles, hasDrm, drmSystem };
}

/**
 * Parse a DASH MPD manifest (basic extraction)
 *
 * @param content The MPD XML content
 * @param _baseUrl The base URL for resolving relative paths (reserved for future use)
 */
export function parseMPDManifest(content: string, _baseUrl: string): {
  variants: StreamVariant[];
  audioTracks: AudioTrack[];
  subtitles: SubtitleTrack[];
  hasDrm: boolean;
  drmSystem?: string;
} {
  const variants: StreamVariant[] = [];
  const audioTracks: AudioTrack[] = [];
  const subtitles: SubtitleTrack[] = [];
  let hasDrm = false;
  let drmSystem: string | undefined;

  // Check for DRM (ContentProtection elements)
  for (const [system, pattern] of Object.entries(DRM_PATTERNS)) {
    if (pattern.test(content)) {
      hasDrm = true;
      drmSystem = system;
      break;
    }
  }

  // Basic regex parsing for Representation elements (video)
  const videoRepRegex = /<Representation[^>]*mimeType="video[^"]*"[^>]*>/gi;
  let match;

  while ((match = videoRepRegex.exec(content)) !== null) {
    const repStr = match[0];
    const variant: StreamVariant = {
      url: '', // MPD uses different URL resolution
      bandwidth: 0,
    };

    const bandwidthMatch = repStr.match(/bandwidth="(\d+)"/);
    if (bandwidthMatch?.[1]) variant.bandwidth = parseInt(bandwidthMatch[1], 10);

    const widthMatch = repStr.match(/width="(\d+)"/);
    const heightMatch = repStr.match(/height="(\d+)"/);
    if (widthMatch?.[1] && heightMatch?.[1]) {
      variant.resolution = `${widthMatch[1]}x${heightMatch[1]}`;
    }

    const codecsMatch = repStr.match(/codecs="([^"]+)"/);
    if (codecsMatch?.[1]) variant.codecs = codecsMatch[1];

    const frameRateMatch = repStr.match(/frameRate="(\d+)"/);
    if (frameRateMatch?.[1]) variant.frameRate = parseInt(frameRateMatch[1], 10);

    if (variant.bandwidth > 0) {
      variants.push(variant);
    }
  }

  // Basic audio track extraction
  const audioAdaptationRegex = /<AdaptationSet[^>]*mimeType="audio[^"]*"[^>]*lang="([^"]+)"[^>]*>/gi;
  while ((match = audioAdaptationRegex.exec(content)) !== null) {
    if (match[1]) {
      audioTracks.push({
        language: match[1],
      });
    }
  }

  // Basic subtitle extraction
  const subtitleRegex = /<AdaptationSet[^>]*mimeType="(text|application\/ttml)[^"]*"[^>]*lang="([^"]+)"[^>]*>/gi;
  while ((match = subtitleRegex.exec(content)) !== null) {
    if (match[2]) {
      subtitles.push({
        language: match[2],
      });
    }
  }

  return { variants, audioTracks, subtitles, hasDrm, drmSystem };
}

/**
 * Select the best quality variant (highest bandwidth)
 */
export function selectBestQuality(variants: StreamVariant[]): StreamVariant | undefined {
  if (variants.length === 0) return undefined;
  return variants.reduce((best, current) =>
    current.bandwidth > best.bandwidth ? current : best
  );
}

/**
 * Select the worst quality variant (lowest bandwidth)
 */
export function selectWorstQuality(variants: StreamVariant[]): StreamVariant | undefined {
  if (variants.length === 0) return undefined;
  return variants.reduce((worst, current) =>
    current.bandwidth < worst.bandwidth ? current : worst
  );
}

/**
 * Format bandwidth for display (e.g., "5.2 Mbps")
 */
export function formatBandwidth(bandwidth: number): string {
  if (bandwidth >= 1_000_000) {
    return `${(bandwidth / 1_000_000).toFixed(1)} Mbps`;
  } else if (bandwidth >= 1_000) {
    return `${(bandwidth / 1_000).toFixed(0)} kbps`;
  }
  return `${bandwidth} bps`;
}

/**
 * Get quality label from variant (resolution or bandwidth)
 */
export function getQualityLabel(variant: StreamVariant): string {
  if (variant.resolution) {
    const height = variant.resolution.split('x')[1];
    return `${height}p`;
  }
  return formatBandwidth(variant.bandwidth);
}

/**
 * Generate ffmpeg download command
 */
export function generateFfmpegCommand(manifestUrl: string, output?: string): string {
  const outputFile = output || 'output.mp4';
  return `ffmpeg -i "${manifestUrl}" -c copy "${outputFile}"`;
}

/**
 * Generate yt-dlp download command
 */
export function generateYtdlpCommand(pageUrl: string, quality: 'best' | 'worst' = 'best'): string {
  const formatOption = quality === 'best' ? 'bestvideo+bestaudio/best' : 'worstvideo+worstaudio/worst';
  return `yt-dlp -f "${formatOption}" "${pageUrl}"`;
}

/**
 * Resolve a potentially relative URL against a base URL
 */
function resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  try {
    return new URL(url, baseUrl).href;
  } catch {
    // If URL resolution fails, return as-is
    return url;
  }
}

/**
 * Extract base URL from a manifest URL
 */
export function getBaseUrl(manifestUrl: string): string {
  const lastSlash = manifestUrl.lastIndexOf('/');
  return lastSlash > 0 ? manifestUrl.substring(0, lastSlash + 1) : manifestUrl;
}
