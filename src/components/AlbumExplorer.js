import { useState, useEffect } from 'react';
import { MusicBrainzService, formatReleaseDate } from '../services/musicbrainz';
import SpotifyPlayer from './SpotifyPlayer';
import styles from '../styles/AlbumExplorer.module.css';

export default function AlbumExplorer() {
  const [albumTitle, setAlbumTitle] = useState('Kind of Blue');
  const [artistName, setArtistName] = useState('Miles Davis');
  const [currentAlbum, setCurrentAlbum] = useState(null);
  const [musicians, setMusicians] = useState([]);
  const [previousAlbums, setPreviousAlbums] = useState([]);
  const [nextAlbums, setNextAlbums] = useState([]);
  const [coverArt, setCoverArt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [artistDiscography, setArtistDiscography] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [albumsPerPage, setAlbumsPerPage] = useState(12);
  const [sortOrder, setSortOrder] = useState('newest'); // 'newest' or 'oldest'
  const [headerPlayer, setHeaderPlayer] = useState(null);

  const searchAlbum = async () => {
    // Need either artist or album title
    if (!artistName && !albumTitle.trim()) return;
    
    setLoading(true);
    
    // Clear previous results
    setCurrentAlbum(null);
    setMusicians([]);
    setPreviousAlbums([]);
    setNextAlbums([]);
    setCoverArt(null);
    setArtistDiscography(null);
    setCurrentPage(1);
    
    try {
      // If no album title provided, show artist discography
      if (!albumTitle.trim() && artistName) {
        await showArtistDiscography(artistName);
        return;
      }
      
      // If no artist provided, search by title only
      if (!artistName && albumTitle.trim()) {
        await searchByTitleOnly(albumTitle);
        return;
      }
      const releases = await MusicBrainzService.searchRelease(albumTitle, artistName);
      if (releases.length > 0) {
        const release = releases[0];
        setCurrentAlbum(release);
        
        const details = await MusicBrainzService.getReleaseDetails(release.id);
        if (details) {
          // Update the release object with the full details (including relations)
          setCurrentAlbum(details);
          
          // Try to find a release with Spotify links for better player experience
          const spotifyRelease = await MusicBrainzService.findReleaseWithSpotify(releases);
          if (spotifyRelease && spotifyRelease.id !== details.id) {
            console.log('Found better release with Spotify links, updating player data');
            // Keep the original release for display info, but store Spotify release for player
            setCurrentAlbum(prev => ({
              ...prev,
              spotifyRelease: spotifyRelease
            }));
            
            // Update header player
            setHeaderPlayer({
              spotifyUrl: MusicBrainzService.generateSpotifyLink(albumTitle, artistName, spotifyRelease),
              albumTitle: albumTitle,
              artistName: artistName
            });
          } else {
            // Only update header player if we have a valid Spotify ID
            const spotifyUrl = MusicBrainzService.generateSpotifyLink(albumTitle, artistName, details);
            const spotifyId = MusicBrainzService.getKnownSpotifyId(albumTitle, artistName) || 
                             MusicBrainzService.extractSpotifyId(spotifyUrl);
            
            if (spotifyId) {
              setHeaderPlayer({
                spotifyUrl: spotifyUrl,
                albumTitle: albumTitle,
                artistName: artistName
              });
            } else {
              console.log('No Spotify ID found, keeping current player');
              // Don't update headerPlayer - keep the current one playing
            }
          }
          const musicianMap = new Map();
          
          if (details['artist-credit']) {
            details['artist-credit'].forEach(credit => {
              musicianMap.set(credit.artist.id, {
                name: credit.artist.name,
                id: credit.artist.id
              });
            });
          }
          
          const recordings = await MusicBrainzService.getReleaseRecordings(release.id);
          
          for (const track of recordings.slice(0, 3)) {
            if (track['artist-credit']) {
              track['artist-credit'].forEach(credit => {
                musicianMap.set(credit.artist.id, {
                  name: credit.artist.name,
                  id: credit.artist.id
                });
              });
            }
            
            if (track.recording && track.recording.id) {
              try {
                const recordingDetails = await MusicBrainzService.getRecordingDetails(track.recording.id);
                if (recordingDetails && recordingDetails.relations) {
                  console.log('Recording relations for', track.title, ':', recordingDetails.relations);
                  recordingDetails.relations.forEach(relation => {
                    if (relation.artist) {
                      let role = 'performer';
                      
                      if (relation.type === 'performance') {
                        role = 'performance';
                      } else if (relation.type === 'vocals') {
                        role = 'vocals';
                      } else if (relation.type === 'instrument') {
                        // Check for specific instrument in attributes
                        if (relation.attributes && relation.attributes.length > 0) {
                          role = relation.attributes.map(attr => attr.value || attr).join(', ');
                        } else if (relation['target-type'] === 'instrument') {
                          role = 'instrument';
                        } else {
                          role = 'instrument';
                        }
                      }
                      
                      // If we already have this musician, prefer more specific roles
                      const existing = musicianMap.get(relation.artist.id);
                      if (!existing || existing.role === 'performer' || existing.role === 'instrument') {
                        musicianMap.set(relation.artist.id, {
                          name: relation.artist.name,
                          id: relation.artist.id,
                          role: role
                        });
                      }
                    }
                  });
                }
              } catch (error) {
                console.error('Error getting recording details:', error);
              }
            }
          }
          
          const relationships = await MusicBrainzService.getReleaseRelationships(release.id);
          relationships.forEach(relation => {
            if (relation.artist) {
              let role = 'performer';
              
              if (relation.type === 'performance') {
                role = 'performance';
              } else if (relation.type === 'vocals') {
                role = 'vocals';
              } else if (relation.type === 'instrument') {
                if (relation.attributes && relation.attributes.length > 0) {
                  role = relation.attributes.map(attr => attr.value || attr).join(', ');
                } else {
                  role = 'instrument';
                }
              }
              
              const existing = musicianMap.get(relation.artist.id);
              if (!existing || existing.role === 'performer' || existing.role === 'instrument') {
                musicianMap.set(relation.artist.id, {
                  name: relation.artist.name,
                  id: relation.artist.id,
                  role: role
                });
              }
            }
          });
          
          setMusicians(Array.from(musicianMap.values()));
          
          const coverUrl = await MusicBrainzService.getCoverArtUrl(release.id);
          setCoverArt(coverUrl);
          
          await findPreviousAndNextAlbums(Array.from(musicianMap.values()), release.date);
        }
      }
    } catch (error) {
      console.error('Error searching album:', error);
    }
    setLoading(false);
  };

  const findPreviousAndNextAlbums = async (musicianList, currentDate) => {
    console.log('Current album:', currentAlbum?.title);
    console.log('Processing musicians:', musicianList.map(m => m.name));
    
    // Clear existing albums first
    setPreviousAlbums([]);
    setNextAlbums([]);
    
    for (const musician of musicianList.slice(0, 6)) {
      try {
        console.log(`\n--- Processing ${musician.name} ---`);
        const releases = await MusicBrainzService.getArtistReleases(musician.id);
        
        // Get clean chronological discography
        const chronology = releases
          .filter(r => {
            if (!r.date) return false;
            const year = parseInt(r.date.split('-')[0]);
            return !isNaN(year) && year >= 1950 && year <= 1980; // Focus on career era
          })
          .sort((a, b) => {
            const aYear = parseInt(a.date.split('-')[0]);
            const bYear = parseInt(b.date.split('-')[0]);
            return aYear - bYear;
          })
          .filter((release, index, arr) => {
            // Remove duplicates by title and year
            const year = parseInt(release.date.split('-')[0]);
            const title = release.title.toLowerCase();
            return !arr.slice(0, index).some(prev => 
              prev.title.toLowerCase() === title && 
              parseInt(prev.date.split('-')[0]) === year
            );
          });
        
        console.log(`${musician.name} discography:`, chronology.map(r => `${r.title} (${parseInt(r.date.split('-')[0])})`));
        
        // Find albums before and after 1959 (Kind of Blue year)
        const referenceYear = 1959;
        
        // Get closest previous album (before 1959)
        const previousAlbums = chronology.filter(r => {
          const year = parseInt(r.date.split('-')[0]);
          return year < referenceYear;
        });
        
        if (previousAlbums.length > 0) {
          const previous = previousAlbums[previousAlbums.length - 1]; // Most recent before 1959
          console.log(`Previous: ${previous.title} (${previous.date})`);
          
          // Get detailed release info to extract Spotify URL and cover art
          let spotifyLink = MusicBrainzService.generateSpotifyLink(previous.title, musician.name);
          let coverArtUrl = null;
          
          try {
            const releaseDetails = await MusicBrainzService.getReleaseDetails(previous.id);
            if (releaseDetails) {
              spotifyLink = MusicBrainzService.generateSpotifyLink(previous.title, musician.name, releaseDetails);
            }
            coverArtUrl = await MusicBrainzService.getCoverArtUrl(previous.id);
          } catch (error) {
            console.log(`Could not get release details for ${previous.title}`);
          }
          
          const albumData = {
            ...previous,
            artistName: musician.name,
            spotifyLink: spotifyLink,
            displayDate: previous.date,
            coverArt: coverArtUrl
          };
          
          // Add to state immediately
          setPreviousAlbums(prev => [...prev, albumData]);
        } else {
          console.log(`No previous album found for ${musician.name}`);
        }
        
        // Get closest next album (after 1959)
        const nextAlbumsForMusician = chronology.filter(r => {
          const year = parseInt(r.date.split('-')[0]);
          return year > referenceYear;
        });
        
        if (nextAlbumsForMusician.length > 0) {
          const next = nextAlbumsForMusician[0]; // First after 1959
          console.log(`Next: ${next.title} (${next.date})`);
          
          // Get detailed release info to extract Spotify URL and cover art
          let spotifyLink = MusicBrainzService.generateSpotifyLink(next.title, musician.name);
          let coverArtUrl = null;
          
          try {
            const releaseDetails = await MusicBrainzService.getReleaseDetails(next.id);
            if (releaseDetails) {
              spotifyLink = MusicBrainzService.generateSpotifyLink(next.title, musician.name, releaseDetails);
            }
            coverArtUrl = await MusicBrainzService.getCoverArtUrl(next.id);
          } catch (error) {
            console.log(`Could not get release details for ${next.title}`);
          }
          
          const albumData = {
            ...next,
            artistName: musician.name,
            spotifyLink: spotifyLink,
            displayDate: next.date,
            coverArt: coverArtUrl
          };
          
          // Add to state immediately
          setNextAlbums(prev => [...prev, albumData]);
        } else {
          console.log(`No next album found for ${musician.name}`);
        }
        
      } catch (error) {
        console.error(`Error getting releases for ${musician.name}:`, error);
      }
    }
    
    console.log('\nFinished processing all musicians');
  };

  const handleAlbumClick = async (albumTitle, artistName) => {
    console.log(`Navigating to: ${albumTitle} by ${artistName}`);
    
    // Update form fields without clearing anything else
    setAlbumTitle(albumTitle);
    setArtistName(artistName);
    
    // Hide discography view when switching to album view
    setArtistDiscography(null);
    
    // Only clear album-specific data, keep the Spotify player playing
    setMusicians([]);
    setPreviousAlbums([]);
    setNextAlbums([]);
    setLoading(true);
    
    // Search for the new album
    try {
      const releases = await MusicBrainzService.searchRelease(albumTitle, artistName);
      if (releases.length > 0) {
        const release = releases[0];
        
        const details = await MusicBrainzService.getReleaseDetails(release.id);
        if (details) {
          // Try to find a release with Spotify links for better player experience
          const spotifyRelease = await MusicBrainzService.findReleaseWithSpotify(releases);
          if (spotifyRelease && spotifyRelease.id !== details.id) {
            console.log('Found better release with Spotify links, updating player data');
            // Keep the original release for display info, but store Spotify release for player
            setCurrentAlbum({
              ...details,
              spotifyRelease: spotifyRelease
            });
          } else {
            setCurrentAlbum(details);
          }
          
          // Only update header player if we have a valid Spotify ID
          const spotifyUrl = MusicBrainzService.generateSpotifyLink(albumTitle, artistName, details);
          const spotifyId = MusicBrainzService.getKnownSpotifyId(albumTitle, artistName) || 
                           MusicBrainzService.extractSpotifyId(spotifyUrl);
          
          if (spotifyId) {
            setHeaderPlayer({
              spotifyUrl: spotifyUrl,
              albumTitle: albumTitle,
              artistName: artistName
            });
          } else {
            console.log('No Spotify ID found for navigation, keeping current player');
            // Don't update headerPlayer - keep the current one playing
          }
          
          const musicianMap = new Map();
          
          if (details['artist-credit']) {
            details['artist-credit'].forEach(credit => {
              musicianMap.set(credit.artist.id, {
                name: credit.artist.name,
                id: credit.artist.id
              });
            });
          }
          
          const recordings = await MusicBrainzService.getReleaseRecordings(release.id);
          
          for (const track of recordings.slice(0, 3)) {
            if (track['artist-credit']) {
              track['artist-credit'].forEach(credit => {
                musicianMap.set(credit.artist.id, {
                  name: credit.artist.name,
                  id: credit.artist.id
                });
              });
            }
            
            if (track.recording && track.recording.id) {
              try {
                const recordingDetails = await MusicBrainzService.getRecordingDetails(track.recording.id);
                if (recordingDetails && recordingDetails.relations) {
                  recordingDetails.relations.forEach(relation => {
                    if (relation.artist) {
                      let role = 'performer';
                      
                      if (relation.type === 'performance') {
                        role = 'performance';
                      } else if (relation.type === 'vocals') {
                        role = 'vocals';
                      } else if (relation.type === 'instrument') {
                        if (relation.attributes && relation.attributes.length > 0) {
                          role = relation.attributes.map(attr => attr.value || attr).join(', ');
                        } else {
                          role = 'instrument';
                        }
                      }
                      
                      const existing = musicianMap.get(relation.artist.id);
                      if (!existing || existing.role === 'performer' || existing.role === 'instrument') {
                        musicianMap.set(relation.artist.id, {
                          name: relation.artist.name,
                          id: relation.artist.id,
                          role: role
                        });
                      }
                    }
                  });
                }
              } catch (error) {
                console.error('Error getting recording details:', error);
              }
            }
          }
          
          const relationships = await MusicBrainzService.getReleaseRelationships(release.id);
          relationships.forEach(relation => {
            if (relation.artist) {
              let role = 'performer';
              
              if (relation.type === 'performance') {
                role = 'performance';
              } else if (relation.type === 'vocals') {
                role = 'vocals';
              } else if (relation.type === 'instrument') {
                if (relation.attributes && relation.attributes.length > 0) {
                  role = relation.attributes.map(attr => attr.value || attr).join(', ');
                } else {
                  role = 'instrument';
                }
              }
              
              const existing = musicianMap.get(relation.artist.id);
              if (!existing || existing.role === 'performer' || existing.role === 'instrument') {
                musicianMap.set(relation.artist.id, {
                  name: relation.artist.name,
                  id: relation.artist.id,
                  role: role
                });
              }
            }
          });
          
          setMusicians(Array.from(musicianMap.values()));
          
          const coverUrl = await MusicBrainzService.getCoverArtUrl(release.id);
          setCoverArt(coverUrl);
          
          await findPreviousAndNextAlbums(Array.from(musicianMap.values()), release.date);
        }
      }
    } catch (error) {
      console.error('Error searching album:', error);
    }
    setLoading(false);
  };

  const showArtistDiscography = async (artistName) => {
    try {
      // First find the artist
      const artists = await MusicBrainzService.searchArtist(artistName);
      if (artists.length > 0) {
        const artist = artists[0];
        console.log('Found artist:', artist.name);
        
        // Get all releases for this artist
        const releases = await MusicBrainzService.getArtistReleases(artist.id);
        
        // Filter and clean the discography
        const discography = releases
          .filter(r => {
            if (!r.date) return false;
            const year = parseInt(r.date.split('-')[0]);
            return !isNaN(year) && year >= 1950 && year <= 2030;
          })
          .sort((a, b) => {
            const aYear = parseInt(a.date.split('-')[0]);
            const bYear = parseInt(b.date.split('-')[0]);
            return bYear - aYear; // Most recent first
          })
          .filter((release, index, arr) => {
            // Remove duplicates by title and year
            const year = parseInt(release.date.split('-')[0]);
            const title = release.title.toLowerCase();
            return !arr.slice(0, index).some(prev => 
              prev.title.toLowerCase() === title && 
              parseInt(prev.date.split('-')[0]) === year
            );
          });

        console.log(`Found ${discography.length} albums for ${artist.name}`);
        
        // Set initial discography without covers
        setArtistDiscography({
          artist: artist,
          albums: discography
        });
        
        // Load covers progressively
        loadCoversProgressively(discography);
      }
    } catch (error) {
      console.error('Error getting artist discography:', error);
    }
  };

  const loadCoversProgressively = async (discography) => {
    // Load covers one by one as they become available
    for (let i = 0; i < discography.length; i++) {
      const album = discography[i];
      try {
        const coverArtUrl = await MusicBrainzService.getCoverArtUrl(album.id);
        if (coverArtUrl) {
          // Update just this album with its cover art
          setArtistDiscography(prev => {
            if (!prev) return prev;
            
            const updatedAlbums = [...prev.albums];
            const albumIndex = updatedAlbums.findIndex(a => a.id === album.id);
            if (albumIndex !== -1) {
              updatedAlbums[albumIndex] = {
                ...updatedAlbums[albumIndex],
                coverArt: coverArtUrl
              };
            }
            
            return {
              ...prev,
              albums: updatedAlbums
            };
          });
        }
      } catch (error) {
        console.log(`Could not load cover for ${album.title}`);
      }
    }
  };

  const searchByTitleOnly = async (title) => {
    try {
      const releases = await MusicBrainzService.searchReleaseByTitle(title);
      
      if (releases.length > 0) {
        // Show search results as a grid similar to discography
        const searchResults = releases.map(release => ({
          ...release,
          // Extract main artist name for display
          artistName: release['artist-credit'] ? release['artist-credit'][0].artist.name : 'Unknown Artist'
        }));
        
        setArtistDiscography({
          artist: { name: `Search results for "${title}"` },
          albums: searchResults
        });
        
        // Load covers progressively for search results
        loadCoversProgressively(searchResults);
      }
    } catch (error) {
      console.error('Error searching by title:', error);
    }
  };

  return (
    <div className={styles.albumExplorer}>
      <div className={styles.searchSection}>
        <h1>Careers in Music</h1>
        <div className={styles.searchForm}>
          <input
            type="text"
            placeholder="Album Title"
            value={albumTitle}
            onChange={(e) => setAlbumTitle(e.target.value)}
          />
          <input
            type="text"
            placeholder="Artist Name"
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
          />
          <button onClick={searchAlbum} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
        
        {(headerPlayer || currentAlbum) && (
          <div className={styles.headerPlayer}>
            {headerPlayer ? (
              <SpotifyPlayer 
                spotifyUrl={headerPlayer.spotifyUrl}
                albumTitle={headerPlayer.albumTitle}
                artistName={headerPlayer.artistName}
              />
            ) : currentAlbum ? (
              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <a 
                  href={MusicBrainzService.generateSpotifyLink(currentAlbum.title, artistName, currentAlbum.spotifyRelease || currentAlbum)}
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
            ) : null}
          </div>
        )}
      </div>

      {currentAlbum && (
        <div className={styles.albumDisplay}>
          <div className={`${styles.sidebar} ${styles.leftSidebar}`}>
            <h3>Previous Albums</h3>
            {previousAlbums.map((album, index) => (
              <div key={index} className={styles.albumLink}>
                <div 
                  onClick={() => handleAlbumClick(album.title, album.artistName)}
                  style={{ cursor: 'pointer' }}
                  className={styles.albumLinkContent}
                >
                  {album.coverArt && (
                    <img 
                      src={album.coverArt} 
                      alt={`${album.title} cover`} 
                      className={styles.albumThumbnail}
                    />
                  )}
                  <div className={styles.albumInfo}>
                    <div className={styles.albumTitle}>{album.title}</div>
                    <div className={styles.artistName}>{album.artistName}</div>
                    <div className={styles.albumDate}>{formatReleaseDate(album.displayDate || album.date)}</div>
                  </div>
                </div>
                <a href={album.spotifyLink} target="_blank" rel="noopener noreferrer" className={styles.spotifyMini}>
                  🎵
                </a>
              </div>
            ))}
          </div>

          <div className={styles.mainContent}>
            <div className={styles.currentAlbum}>
              <h2>{currentAlbum.title}</h2>
              <div className={styles.albumReleaseDate}>{formatReleaseDate(currentAlbum.date)}</div>
              {coverArt && (
                <img src={coverArt} alt={`${currentAlbum.title} cover`} className={styles.albumCover} />
              )}
              
              {!headerPlayer && (
                <div style={{ textAlign: 'center', margin: '20px 0' }}>
                  <a 
                    href={MusicBrainzService.generateSpotifyLink(currentAlbum.title, artistName, currentAlbum.spotifyRelease || currentAlbum)}
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
                    🎵 Stream on Spotify
                  </a>
                </div>
              )}
              
              <div className={styles.musiciansSection}>
                <h3>Musicians on this album:</h3>
                <ul className={styles.musiciansList}>
                  {musicians.map((musician, index) => (
                    <li key={index} className={styles.musician}>
                      <div 
                        className={styles.musicianName}
                        onClick={() => {
                          setArtistName(musician.name);
                          setAlbumTitle('');
                          showArtistDiscography(musician.name);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {musician.name}
                      </div>
                      {musician.role && (
                        <div className={styles.musicianRole}>{musician.role}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className={`${styles.sidebar} ${styles.rightSidebar}`}>
            <h3>Next Albums</h3>
            {nextAlbums.map((album, index) => (
              <div key={index} className={styles.albumLink}>
                <div 
                  onClick={() => handleAlbumClick(album.title, album.artistName)}
                  style={{ cursor: 'pointer' }}
                  className={styles.albumLinkContent}
                >
                  {album.coverArt && (
                    <img 
                      src={album.coverArt} 
                      alt={`${album.title} cover`} 
                      className={styles.albumThumbnail}
                    />
                  )}
                  <div className={styles.albumInfo}>
                    <div className={styles.albumTitle}>{album.title}</div>
                    <div className={styles.artistName}>{album.artistName}</div>
                    <div className={styles.albumDate}>{formatReleaseDate(album.displayDate || album.date)}</div>
                  </div>
                </div>
                <a href={album.spotifyLink} target="_blank" rel="noopener noreferrer" className={styles.spotifyMini}>
                  🎵
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {artistDiscography && (
        <div className={styles.discographyView}>
          <h2 className={styles.discographyTitle}>
            {artistDiscography.artist.name} - Complete Discography
          </h2>
          
          <div className={styles.discographyControls}>
            <label className={styles.albumsPerPageLabel}>
              Albums per page:
              <select 
                value={albumsPerPage} 
                onChange={(e) => {
                  setAlbumsPerPage(parseInt(e.target.value));
                  setCurrentPage(1); // Reset to first page when changing page size
                }}
                className={styles.albumsPerPageSelect}
              >
                <option value={6}>6</option>
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
              </select>
            </label>
            
            <label className={styles.albumsPerPageLabel}>
              Sort by:
              <select 
                value={sortOrder} 
                onChange={(e) => {
                  setSortOrder(e.target.value);
                  setCurrentPage(1); // Reset to first page when changing sort
                }}
                className={styles.albumsPerPageSelect}
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </label>
          </div>
          
          <div className={styles.albumGrid}>
            {artistDiscography.albums
              .sort((a, b) => {
                const aYear = parseInt(a.date.split('-')[0]);
                const bYear = parseInt(b.date.split('-')[0]);
                return sortOrder === 'newest' ? bYear - aYear : aYear - bYear;
              })
              .slice((currentPage - 1) * albumsPerPage, currentPage * albumsPerPage)
              .map((album, index) => (
                <div 
                  key={album.id} 
                  className={styles.albumCard}
                  onClick={() => handleAlbumClick(album.title, album.artistName || artistDiscography.artist.name)}
                >
                  {album.coverArt && (
                    <img 
                      src={album.coverArt} 
                      alt={`${album.title} cover`} 
                      className={styles.albumCardCover}
                    />
                  )}
                  <div className={styles.albumCardInfo}>
                    <h3 className={styles.albumCardTitle}>{album.title}</h3>
                    {album.artistName && album.artistName !== artistDiscography.artist.name && (
                      <p className={styles.albumCardArtist}>{album.artistName}</p>
                    )}
                    <p className={styles.albumCardDate}>{formatReleaseDate(album.date)}</p>
                  </div>
                </div>
              ))}
          </div>
          
          {artistDiscography.albums.length > albumsPerPage && (
            <div className={styles.pagination}>
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className={styles.pageButton}
              >
                Previous
              </button>
              
              <span className={styles.pageInfo}>
                Page {currentPage} of {Math.ceil(artistDiscography.albums.length / albumsPerPage)}
              </span>
              
              <button 
                onClick={() => setCurrentPage(prev => 
                  Math.min(Math.ceil(artistDiscography.albums.length / albumsPerPage), prev + 1)
                )}
                disabled={currentPage >= Math.ceil(artistDiscography.albums.length / albumsPerPage)}
                className={styles.pageButton}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}