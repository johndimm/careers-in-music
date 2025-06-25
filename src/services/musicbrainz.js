const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';

// Format MusicBrainz dates nicely
const formatReleaseDate = (dateString) => {
  if (!dateString) return '';
  
  const parts = dateString.split('-');
  if (parts.length === 1) {
    // Just year: "1959"
    return parts[0];
  } else if (parts.length === 2) {
    // Year and month: "1959-08"
    const year = parts[0];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[parseInt(parts[1]) - 1];
    return `${month} ${year}`;
  } else if (parts.length === 3) {
    // Full date: "1959-08-17"
    const year = parts[0];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const month = monthNames[parseInt(parts[1]) - 1];
    const day = parseInt(parts[2]);
    return `${month} ${day}, ${year}`;
  }
  
  return dateString; // Fallback
};

// Rate limiting helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let lastRequestTime = 0;

const rateLimitedFetch = async (url) => {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  // MusicBrainz requests a minimum of 1 second between requests
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

export { formatReleaseDate };

export class MusicBrainzService {
  static async searchArtist(artistName) {
    try {
      const response = await rateLimitedFetch(
        `${MUSICBRAINZ_BASE_URL}/artist?query=${encodeURIComponent(artistName)}&fmt=json&limit=10`
      );
      const data = await response.json();
      return data.artists || [];
    } catch (error) {
      console.error('Error searching for artist:', error);
      return [];
    }
  }

  static async searchReleaseByTitle(title) {
    try {
      const query = `release:"${title}"`;
      const response = await rateLimitedFetch(
        `${MUSICBRAINZ_BASE_URL}/release?query=${encodeURIComponent(query)}&fmt=json&limit=50&inc=artist-credits`
      );
      const data = await response.json();
      
      if (data.releases && data.releases.length > 0) {
        // Filter and sort releases
        const filteredReleases = data.releases
          .filter(r => r.date) // Only releases with dates
          .filter(r => {
            // Filter out obvious reissues/compilations
            const title = r.title.toLowerCase();
            const isReissue = title.includes('remaster') || 
                             title.includes('reissue') || 
                             title.includes('compilation') ||
                             title.includes('collection') ||
                             title.includes('best of') ||
                             title.includes('greatest');
            return !isReissue;
          })
          .sort((a, b) => {
            // Sort by date, most recent first
            const aYear = parseInt(a.date.split('-')[0]);
            const bYear = parseInt(b.date.split('-')[0]);
            return bYear - aYear;
          });
        
        console.log(`Found ${filteredReleases.length} releases for title "${title}"`);
        return filteredReleases;
      }
      
      return [];
    } catch (error) {
      console.error('Error searching for release by title:', error);
      return [];
    }
  }

  static async searchRelease(albumTitle, artistName) {
    try {
      const query = `release:"${albumTitle}" AND artist:"${artistName}"`;
      const response = await rateLimitedFetch(
        `${MUSICBRAINZ_BASE_URL}/release?query=${encodeURIComponent(query)}&fmt=json&limit=20&inc=artist-credits`
      );
      const data = await response.json();
      
      if (data.releases && data.releases.length > 0) {
        // Sort by date to find the earliest (original) release
        const sortedReleases = data.releases
          .filter(r => r.date) // Only releases with dates
          .sort((a, b) => {
            const aYear = parseInt(a.date.split('-')[0]);
            const bYear = parseInt(b.date.split('-')[0]);
            return aYear - bYear;
          });
        
        if (sortedReleases.length > 0) {
          console.log(`Found ${sortedReleases.length} dated releases for "${albumTitle}"`);
          console.log(`Using earliest release: ${sortedReleases[0].title} (${sortedReleases[0].date})`);
          
          // Return earliest first, but also include some recent releases that might have Spotify links
          const recentReleases = sortedReleases.filter(r => {
            const year = parseInt(r.date.split('-')[0]);
            return year >= 2000; // Modern releases more likely to have Spotify
          }).slice(0, 3);
          
          return [sortedReleases[0], ...recentReleases, ...sortedReleases.slice(1)];
        }
        
        return data.releases;
      }
      
      return [];
    } catch (error) {
      console.error('Error searching for release:', error);
      return [];
    }
  }

  static async getReleaseDetails(releaseId) {
    try {
      const response = await rateLimitedFetch(
        `${MUSICBRAINZ_BASE_URL}/release/${releaseId}?fmt=json&inc=artist-credits+recordings+release-groups+url-rels`
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting release details:', error);
      return null;
    }
  }

  static async getArtistReleases(artistId) {
    try {
      const response = await rateLimitedFetch(
        `${MUSICBRAINZ_BASE_URL}/release?artist=${artistId}&fmt=json&limit=100&inc=release-groups&type=album&status=official`
      );
      const data = await response.json();
      
      // Filter to get original releases, not reissues
      const filteredReleases = data.releases ? data.releases.filter(release => {
        // Prefer releases that don't look like reissues
        const title = release.title.toLowerCase();
        const isReissue = title.includes('remaster') || 
                         title.includes('reissue') || 
                         title.includes('compilation') ||
                         title.includes('collection') ||
                         title.includes('best of') ||
                         title.includes('greatest') ||
                         release.disambiguation?.toLowerCase().includes('reissue');
        return !isReissue;
      }) : [];
      
      return filteredReleases;
    } catch (error) {
      console.error('Error getting artist releases:', error);
      return [];
    }
  }

  static async getReleaseRecordings(releaseId) {
    try {
      const response = await rateLimitedFetch(
        `${MUSICBRAINZ_BASE_URL}/release/${releaseId}?fmt=json&inc=recordings+artist-credits`
      );
      const data = await response.json();
      return data.media ? data.media.flatMap(medium => medium.tracks || []) : [];
    } catch (error) {
      console.error('Error getting release recordings:', error);
      return [];
    }
  }

  static async getRecordingDetails(recordingId) {
    try {
      const response = await rateLimitedFetch(
        `${MUSICBRAINZ_BASE_URL}/recording/${recordingId}?fmt=json&inc=artist-credits+artist-rels+work-rels`
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting recording details:', error);
      return null;
    }
  }

  static async getReleaseRelationships(releaseId) {
    try {
      const response = await rateLimitedFetch(
        `${MUSICBRAINZ_BASE_URL}/release/${releaseId}?fmt=json&inc=artist-rels`
      );
      const data = await response.json();
      return data.relations || [];
    } catch (error) {
      console.error('Error getting release relationships:', error);
      return [];
    }
  }

  static extractSpotifyUrl(release) {
    console.log('Checking for Spotify URLs in release:', release.title);
    console.log('Release relations:', release.relations);
    
    if (release.relations) {
      // Log all URL relations to see what we have
      const urlRelations = release.relations.filter(rel => rel.url);
      console.log('All URL relations:', urlRelations.map(rel => ({
        type: rel.type,
        url: rel.url.resource
      })));
      
      const spotifyRelation = release.relations.find(rel => 
        rel.url && 
        rel.url.resource && 
        rel.url.resource.includes('spotify.com')
      );
      
      if (spotifyRelation) {
        console.log('Found Spotify URL:', spotifyRelation.url.resource);
        return spotifyRelation.url.resource;
      } else {
        console.log('No Spotify URL found in relations');
      }
    } else {
      console.log('No relations found in release data');
    }
    return null;
  }

  static getKnownSpotifyId(albumTitle, artistName) {
    // Hardcoded Spotify IDs for famous albums
    const knownAlbums = {
      'kind of blue_miles davis': '1weenld61qoidwYuZ1GESA',
      'abbey road_the beatles': '0ETFjACtuP2ADo6LFhL6HN',
      'the dark side of the moon_pink floyd': '4LH4d3cOWNNsVw41Gqt2kv',
      'nevermind_nirvana': '2UJcKiJxNryhL050F5Z1Fk',
      'thriller_michael jackson': '2ANVost0y2y52ema1E9xAZ',
      'rumours_fleetwood mac': '1bt6q2SruMsBtcerNVtpZB',
      'blue train_john coltrane': '1dVgLNKdRrCjV5xNrWW1bY',
      'giant steps_john coltrane': '1Q8Jzk0YCJTqjGPdKmNhxP'
    };
    
    const key = `${albumTitle.toLowerCase()}_${artistName.toLowerCase()}`;
    return knownAlbums[key] || null;
  }

  static extractSpotifyId(spotifyUrl) {
    if (!spotifyUrl || !spotifyUrl.includes('spotify.com')) return null;
    
    // Extract ID from URLs like:
    // https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv
    const match = spotifyUrl.match(/\/album\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  static async findReleaseWithSpotify(releases) {
    // Try to find a release that has Spotify links
    for (const release of releases.slice(0, 5)) { // Check first 5 releases
      try {
        const details = await this.getReleaseDetails(release.id);
        if (details && this.extractSpotifyUrl(details)) {
          console.log(`Found release with Spotify: ${details.title} (${details.date})`);
          return details;
        }
      } catch (error) {
        console.log(`Error checking release ${release.title}`);
      }
    }
    return null;
  }

  static generateSpotifyLink(albumTitle, artistName, release = null) {
    // First try to get direct Spotify URL from MusicBrainz
    if (release) {
      const directUrl = this.extractSpotifyUrl(release);
      if (directUrl) {
        return directUrl;
      }
    }
    
    // Fallback to search
    const searchQuery = `${albumTitle} ${artistName}`.replace(/\s+/g, '%20');
    return `https://open.spotify.com/search/${searchQuery}`;
  }

  static async getCoverArtUrl(releaseId) {
    try {
      const response = await fetch(
        `https://coverartarchive.org/release/${releaseId}`,
        { method: 'HEAD' }
      );
      if (response.ok) {
        return `https://coverartarchive.org/release/${releaseId}/front-250`;
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}