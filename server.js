/**
 * ZALO PROXY SERVER - FIXED VERSION
 * Extract name from <title> tag since content is JS-rendered
 */

const express = require('express');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

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
    console.log(`🔍 Scraping Zalo for ${cleanPhone}...`);
    
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate
    const url = `https://zalo.me/${cleanPhone}`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
    
    // Wait longer for JS to render
    await page.waitForTimeout(4000);
    
    // Extract data
    const result = await page.evaluate(() => {
      // Method 1: From <title> tag (MOST RELIABLE)
      const title = document.title;
      if (title && title.includes(' - ')) {
        const name = title.split(' - ')[1]?.replace('Zalo', '').trim();
        if (name && name.length > 0 && name !== 'Zalo') {
          return {
            name: name,
            status: 'Tồn tại',
            method: 'title'
          };
        }
      }
      
      // Method 2: From rendered content
      const selectors = [
        'h1.main__name',
        '.main__name',
        'h1[class*="name"]',
        '[class*="card-name"]'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return {
            name: element.textContent.trim(),
            status: 'Tồn tại',
            method: selector
          };
        }
      }
      
      // Method 3: Check for error message
      const body = document.body.innerHTML;
      if (body.includes('Tài khoản này không tồn tại') || 
          body.includes('không cho phép tìm kiếm')) {
        return {
          name: '',
          status: 'Không tồn tại',
          method: 'error'
        };
      }
      
      // Method 4: From meta og:title
      const metaTitle = document.querySelector('meta[property="og:title"]');
      if (metaTitle) {
        const content = metaTitle.getAttribute('content');
        if (content && content.includes(' - ')) {
          const name = content.split(' - ')[1]?.replace('Zalo', '').trim();
          if (name && name.length > 0) {
            return {
              name: name,
              status: 'Tồn tại',
              method: 'meta'
            };
          }
        }
      }
      
      return {
        name: '',
        status: 'Không xác định',
        method: 'none'
      };
    });
    
    await browser.close();
    
    const response = {
      phone: cleanPhone,
      name: result.name || '',
      status: result.status || 'Không xác định',
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    cache_size: cache.size,
    uptime: process.uptime()
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
    message: 'Zalo Proxy Server',
    endpoints: {
      health: '/health',
      api: '/api/zalo?phone=0398981698',
      clearCache: '/cache/clear (POST)'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Zalo Proxy Server running on port ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`📍 API: http://localhost:${PORT}/api/zalo?phone=0398981698`);
});

// Auto clear old cache every hour
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
