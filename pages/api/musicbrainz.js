// Next.js API route to proxy MusicBrainz requests and avoid CORS issues

const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';

let lastRequestTime = 0;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const rateLimitedFetch = async (url) => {
  const timeSinceLastRequest = Date.now() - lastRequestTime;
  
  // MusicBrainz rate limit: max 1 request per 1.2 seconds
  if (timeSinceLastRequest < 1200) {
    await sleep(1200 - timeSinceLastRequest);
  }
  
  lastRequestTime = Date.now();
  return fetch(url, {
    headers: {
      'User-Agent': 'CareersInMusic/1.0 (careers-in-music-app)'
    }
  });
};

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { path, ...queryParams } = req.query;
    
    if (!path) {
      res.status(400).json({ error: 'Path parameter is required' });
      return;
    }

    // Construct the MusicBrainz URL
    const url = new URL(`${MUSICBRAINZ_BASE_URL}/${Array.isArray(path) ? path.join('/') : path}`);
    
    // Add query parameters
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value) {
        url.searchParams.append(key, value);
      }
    });

    console.log('Proxying request to:', url.toString());

    const response = await rateLimitedFetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
    
    res.status(200).json(data);
  } catch (error) {
    console.error('MusicBrainz proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from MusicBrainz API', details: error.message });
  }
}