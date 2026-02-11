/**
 * ZALO PROXY SERVER - SIMPLE VERSION
 * No Puppeteer - Just fetch HTML and parse <title>
 */

const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 giờ

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Fetch HTML from Zalo
function fetchZaloPage(phone) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'zalo.me',
      path: `/${phone}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    };

    const req = https.request(options, (response) => {
      let data = '';

      // Handle gzip
      const encoding = response.headers['content-encoding'];
      let stream = response;
      
      if (encoding === 'gzip') {
        const zlib = require('zlib');
        stream = response.pipe(zlib.createGunzip());
      }

      stream.on('data', (chunk) => {
        data += chunk;
      });

      stream.on('end', () => {
        resolve(data);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

// Extract name from HTML
function extractName(html) {
  // Method 1: From <title> tag
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    const title = titleMatch[1];
    // Format: "Zalo - Vũ Thị Nhài" or "Tên Người Dùng - Zalo"
    if (title.includes(' - ')) {
      const parts = title.split(' - ');
      for (const part of parts) {
        const cleaned = part.trim();
        if (cleaned && cleaned !== 'Zalo' && cleaned.length > 1) {
          return cleaned;
        }
      }
    }
  }

  // Method 2: From meta og:title
  const metaMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (metaMatch && metaMatch[1]) {
    const content = metaMatch[1];
    if (content.includes(' - ')) {
      const parts = content.split(' - ');
      for (const part of parts) {
        const cleaned = part.trim();
        if (cleaned && cleaned !== 'Zalo' && cleaned.length > 1) {
          return cleaned;
        }
      }
    }
  }

  // Method 3: From meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (descMatch && descMatch[1]) {
    const desc = descMatch[1];
    // Extract name from description
    const nameMatch = desc.match(/Zalo\s*-\s*([^(]+)/i);
    if (nameMatch && nameMatch[1]) {
      return nameMatch[1].trim();
    }
  }

  return '';
}

// Check if account doesn't exist
function isNotFound(html) {
  const patterns = [
    'Tài khoản này không tồn tại',
    'không cho phép tìm kiếm',
    'không tìm thấy',
    'not found'
  ];

  const lowerHtml = html.toLowerCase();
  for (const pattern of patterns) {
    if (lowerHtml.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

// Main API endpoint
app.get('/api/zalo', async (req, res) => {
  const phone = req.query.phone;
  
  if (!phone) {
    return res.status(400).json({ error: 'Missing phone parameter' });
  }
  
  const cleanPhone = phone.toString().trim().replace(/\s/g, '').replace(/\+84/, '0');
  
  // Check cache
  const cacheKey = `zalo_${cleanPhone}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`✅ Cache hit for ${cleanPhone}`);
    return res.json(cached.data);
  }
  
  try {
    console.log(`🔍 Fetching Zalo for ${cleanPhone}...`);
    
    const html = await fetchZaloPage(cleanPhone);
    
    let name = extractName(html);
    let status = '';
    
    if (name && name.length > 0) {
      status = 'Tồn tại';
    } else if (isNotFound(html)) {
      status = 'Không tồn tại';
      name = '';
    } else {
      status = 'Không xác định';
      name = '';
    }
    
    const response = {
      phone: cleanPhone,
      name: name,
      status: status,
      timestamp: new Date().toISOString()
    };
    
    // Save to cache
    cache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });
    
    console.log(`✅ Result for ${cleanPhone}:`, response);
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      phone: cleanPhone,
      name: '',
      status: 'Lỗi',
      error: error.message
    });
  }
});

// Debug endpoint - return raw HTML
app.get('/api/debug', async (req, res) => {
  const phone = req.query.phone || '0398981698';
  
  try {
    const html = await fetchZaloPage(phone);
    
    // Return first 2000 chars
    res.type('text/plain').send(html.substring(0, 2000));
    
  } catch (error) {
    res.status(500).send('Error: ' + error.message);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    cache_size: cache.size,
    uptime: process.uptime(),
    version: '2.0-simple'
  });
});

// Clear cache
app.post('/cache/clear', (req, res) => {
  const size = cache.size;
  cache.clear();
  res.json({ 
    message: 'Cache cleared', 
    cleared: size,
    cache_size: 0 
  });
});

// Homepage
app.get('/', (req, res) => {
  res.json({
    message: 'Zalo Proxy Server - Simple Version (No Puppeteer)',
    version: '2.0',
    endpoints: {
      health: '/health',
      api: '/api/zalo?phone=0398981698',
      debug: '/api/debug?phone=0398981698',
      clearCache: '/cache/clear (POST)'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Zalo Proxy Server (Simple) running on port ${PORT}`);
  console.log(`📍 Version: No Puppeteer - Direct HTML fetch`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
});

// Auto clear old cache
setInterval(() => {
  const now = Date.now();
  let cleared = 0;
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
      cleared++;
    }
  }
  if (cleared > 0) {
    console.log(`🧹 Auto-cleared ${cleared} expired cache entries`);
  }
}, 60 * 60 * 1000);
