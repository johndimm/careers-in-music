import { MusicBrainzService } from '../services/musicbrainz';

export default function SpotifyPlayer({ spotifyUrl, albumTitle, artistName }) {
  // First check for known/hardcoded Spotify IDs
  let spotifyId = MusicBrainzService.getKnownSpotifyId(albumTitle, artistName);
  
  // If not found in known albums, try to extract from URL
  if (!spotifyId) {
    spotifyId = MusicBrainzService.extractSpotifyId(spotifyUrl);
  }
  
  console.log('SpotifyPlayer - Album:', albumTitle, 'Artist:', artistName, 'ID:', spotifyId);
  
  // Only show embed player if we have a valid Spotify ID
  if (spotifyId) {
    return (
      <div style={{ margin: '20px 0' }}>
        <iframe
          src={`https://open.spotify.com/embed/album/${spotifyId}?utm_source=generator&theme=0`}
          width="100%"
          height="152"
          frameBorder="0"
          allowfullscreen=""
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          style={{
            borderRadius: '12px',
            background: '#1db954'
          }}
        ></iframe>
      </div>
    );
  }
  
  // If no Spotify ID found, show simple link button
  return (
    <div style={{ margin: '20px 0', textAlign: 'center' }}>
      <a 
        href={spotifyUrl}
        target="_blank" 
        rel="noopener noreferrer"
        style={{
          display: 'inline-block',
          background: '#1db954',
          color: 'white',
          padding: '12px 24px',
          textDecoration: 'none',
          borderRadius: '25px',
          fontWeight: 'bold',
          transition: 'all 0.3s ease'
        }}
        onMouseOver={(e) => e.target.style.background = '#1ed760'}
        onMouseOut={(e) => e.target.style.background = '#1db954'}
      >
        🎵 Listen on Spotify
      </a>
    </div>
  );
}