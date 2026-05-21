// 资源分类系统
const RESOURCE_TYPES = {
  images: {
    name: '图片',
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff'],
    mimeTypes: ['image/']
  },
  scripts: {
    name: 'JavaScript',
    extensions: ['.js'],
    mimeTypes: ['text/javascript', 'application/javascript']
  },
  styles: {
    name: 'CSS样式',
    extensions: ['.css'],
    mimeTypes: ['text/css']
  },
  fonts: {
    name: '字体',
    extensions: ['.woff', '.woff2', '.ttf', '.otf', '.eot'],
    mimeTypes: ['font/', 'application/font-', 'application/x-font-']
  },
  media: {
    name: '媒体文件',
    extensions: ['.mp4', '.webm', '.mp3', '.wav', '.ogg'],
    mimeTypes: ['video/', 'audio/']
  },
  links: {
    name: '外部链接',
    extensions: [],
    mimeTypes: []
  },
  other: {
    name: '其他资源',
    extensions: [],
    mimeTypes: []
  }
};

function extractAllResources(html, baseUrl) {
  const resources = [];
  const seen = new Set();

  try {
    const baseOrigin = new URL(baseUrl).origin;

    // 提取图片
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      addResource(match[1], 'images', 'img', resources, seen, baseOrigin, baseUrl);
    }

    // 提取图片 srcset
    const srcsetRegex = /<img[^>]+srcset=["']([^"']+)["'][^>]*>/gi;
    while ((match = srcsetRegex.exec(html)) !== null) {
      const srcset = match[1];
      const srcsetParts = srcset.split(/,\s*/);
      srcsetParts.forEach(part => {
        const url = part.trim().split(/\s+/)[0];
        if (url) addResource(url, 'images', 'srcset', resources, seen, baseOrigin, baseUrl);
      });
    }

    // 提取 JavaScript
    const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((match = scriptRegex.exec(html)) !== null) {
      addResource(match[1], 'scripts', 'script', resources, seen, baseOrigin, baseUrl);
    }

    // 提取 CSS
    const cssRegex = /<link[^>]+href=["']([^"']+)["'][^>]*>/gi;
    while ((match = cssRegex.exec(html)) !== null) {
      addResource(match[1], 'styles', 'link', resources, seen, baseOrigin, baseUrl);
    }

    // 提取背景图片
    const bgImgRegex = /background(?:-image)?\s*:\s*url\(['"]?([^)'"]+)['"]?\)/gi;
    while ((match = bgImgRegex.exec(html)) !== null) {
      addResource(match[1], 'images', 'background', resources, seen, baseOrigin, baseUrl);
    }

    // 提取视频
    const videoSrcRegex = /<video[^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((match = videoSrcRegex.exec(html)) !== null) {
      addResource(match[1], 'media', 'video', resources, seen, baseOrigin, baseUrl);
    }

    // 提取视频源
    const sourceRegex = /<source[^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((match = sourceRegex.exec(html)) !== null) {
      addResource(match[1], 'media', 'source', resources, seen, baseOrigin, baseUrl);
    }

    // 提取音频
    const audioRegex = /<audio[^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((match = audioRegex.exec(html)) !== null) {
      addResource(match[1], 'media', 'audio', resources, seen, baseOrigin, baseUrl);
    }

    // 提取锚点链接
    const aRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    while ((match = aRegex.exec(html)) !== null) {
      addResource(match[1], 'links', 'a', resources, seen, baseOrigin, baseUrl);
    }

    // 提取 favicon
    const iconRegex = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
    while ((match = iconRegex.exec(html)) !== null) {
      addResource(match[1], 'images', 'icon', resources, seen, baseOrigin, baseUrl);
    }

    // 提取字体
    const fontRegex = /@font-face[^}]*url\(['"]?([^)'"]+)['"]?\)/gi;
    while ((match = fontRegex.exec(html)) !== null) {
      addResource(match[1], 'fonts', 'font', resources, seen, baseOrigin, baseUrl);
    }
  } catch (e) {
    console.error('Error extracting resources:', e);
  }

  return resources;
}

function addResource(rawUrl, defaultType, sourceElement, resources, seen, baseOrigin, baseUrl) {
  let url;
  try {
    url = new URL(rawUrl, baseUrl).toString();
  } catch {
    return;
  }

  if (seen.has(url) || url.startsWith('data:')) {
    return;
  }

  seen.add(url);

  const resourceType = detectResourceType(url);
  const isInternal = url.startsWith(baseOrigin);

  resources.push({
    id: generateResourceId(url),
    url,
    type: resourceType,
    sourceElement,
    isInternal,
    fileName: extractFileName(url),
    size: null,
    downloaded: false
  });
}

function detectResourceType(url) {
  const lowerUrl = url.toLowerCase();
  
  for (const [type, config] of Object.entries(RESOURCE_TYPES)) {
    if (type === 'links' || type === 'other') continue;
    
    const hasMatchingExtension = config.extensions.some(ext => lowerUrl.includes(ext));
    if (hasMatchingExtension) {
      return type;
    }
  }

  // 检查是否是链接
  if (url.includes('://') || url.startsWith('/')) {
    return 'links';
  }

  return 'other';
}

function extractFileName(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function generateResourceId(url) {
  return 'res_' + Buffer.from(url).toString('base64').slice(0, 20).replace(/[^a-zA-Z0-9]/g, '');
}

function groupResourcesByType(resources) {
  const grouped = {};
  for (const type of Object.keys(RESOURCE_TYPES)) {
    grouped[type] = resources.filter(r => r.type === type);
  }
  return grouped;
}

function filterResources(resources, filters = {}) {
  return resources.filter(resource => {
    if (filters.types && filters.types.length > 0 && !filters.types.includes(resource.type)) {
      return false;
    }
    if (filters.isInternal !== undefined && resource.isInternal !== filters.isInternal) {
      return false;
    }
    if (filters.search) {
      const search = filters.search.toLowerCase();
      if (!resource.url.toLowerCase().includes(search) && 
          !resource.fileName.toLowerCase().includes(search)) {
        return false;
      }
    }
    return true;
  });
}

export {
  extractAllResources,
  groupResourcesByType,
  filterResources,
  RESOURCE_TYPES
};
