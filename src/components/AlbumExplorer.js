import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { MusicBrainzService, formatReleaseDate } from '../services/musicbrainz';
import SpotifyPlayer from './SpotifyPlayer';
import styles from '../styles/AlbumExplorer.module.css';

export default function AlbumExplorer() {
  const router = useRouter();
  const [albumTitle, setAlbumTitle] = useState('');
  const [artistName, setArtistName] = useState('');
  const [currentAlbum, setCurrentAlbum] = useState(null);
  const [musicians, setMusicians] = useState([]);
  const [coverArt, setCoverArt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [artistDiscography, setArtistDiscography] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [albumsPerPage, setAlbumsPerPage] = useState(12);
  const [sortOrder, setSortOrder] = useState('newest'); // 'newest' or 'oldest'
  const [headerPlayer, setHeaderPlayer] = useState(null);
  const [trackList, setTrackList] = useState([]);
  const [showMusiciansTimeline, setShowMusiciansTimeline] = useState(false);
  const [musiciansTimelineData, setMusiciansTimelineData] = useState(null);
  const [timelineZoom, setTimelineZoom] = useState(1); // Start at 100% size
  const [timelineInitialized, setTimelineInitialized] = useState(false);
  const [selectedAlbumsByYear, setSelectedAlbumsByYear] = useState(new Map()); // Track which album is shown for each year


  // Handle URL parameters on mount
  useEffect(() => {
    if (router.isReady) {
      const { artist, album, title, page, limit, sort } = router.query;
      console.log('URL params:', { artist, album, title, page, limit, sort });
      
      if (artist) {
        setArtistName(artist);
        
        if (album || title) {
          // Show specific album: ?artist=Miles%20Davis&album=Kind%20of%20Blue
          const albumParam = album || title;
          setAlbumTitle(albumParam);
          console.log('Setting album title to:', albumParam);
        } else {
          // Show discography: ?artist=Miles%20Davis
          setAlbumTitle('');
        }
      } else if (title) {
        // Title-only search: ?title=stag%20party
        console.log('Title-only search for:', title);
        setArtistName('');
        setAlbumTitle(title);
      } else if (Object.keys(router.query).length === 0) {
        // No URL params, show default
        setArtistName('Miles Davis');
        setAlbumTitle('Kind of Blue');
      }
      
      // Set pagination and sort from URL
      if (page) setCurrentPage(parseInt(page));
      if (limit) setAlbumsPerPage(parseInt(limit));
      if (sort) setSortOrder(sort);
    }
  }, [router.isReady, router.query]);

  // Auto-search when URL params set the state
  useEffect(() => {
    if (router.isReady && (artistName || albumTitle)) {
      // Auto-search if we have URL params or if it's the default load
      const hasUrlParams = router.query.artist || router.query.album || router.query.title;
      const isDefaultLoad = Object.keys(router.query).length === 0 && artistName === 'Miles Davis' && albumTitle === 'Kind of Blue';
      
      if (hasUrlParams || isDefaultLoad) {
        console.log('Auto-searching album, showMusiciansTimeline:', showMusiciansTimeline);
        // Ensure we're not in timeline mode for startup
        setShowMusiciansTimeline(false);
        setTimelineInitialized(false);
        setSelectedAlbumsByYear(new Map()); // Reset album selections
        searchAlbum();
      }
    }
  }, [router.isReady, artistName, albumTitle]); // Need dependencies to trigger search

  // Load covers when pagination changes
  useEffect(() => {
    if (artistDiscography) {
      loadCoversForCurrentPage();
    }
  }, [currentPage, albumsPerPage, sortOrder, artistDiscography]);

  // Initial positioning when timeline data loads or updates
  useEffect(() => {
    if (showMusiciansTimeline && musiciansTimelineData && musiciansTimelineData.musicians.length > 0) {
      setTimeout(() => {
        positionAlbumsByYear();
        renderYearScale();
        
        // Only set initialized after first musician is positioned
        if (!timelineInitialized) {
          setTimelineInitialized(true);
        }
      }, 100);
    }
  }, [showMusiciansTimeline, musiciansTimelineData]);

  // Update zoom without repositioning
  useEffect(() => {
    if (showMusiciansTimeline && musiciansTimelineData) {
      const timelineElement = document.querySelector(`.${styles.musiciansTimeline}`);
      if (timelineElement) {
        timelineElement.style.setProperty('--album-cover-size', `${60 * timelineZoom}px`);
      }
      
      // Only update layout if timeline is initialized
      if (timelineInitialized) {
        setTimeout(() => {
          updateLayoutForZoom();
        }, 50);
      }
    }
  }, [timelineZoom]);

  // Load covers when musicians timeline data changes or when scrolling
  useEffect(() => {
    if (musiciansTimelineData && musiciansTimelineData.musicians && musiciansTimelineData.musicians.length > 0) {
      // Delay to allow DOM to update
      setTimeout(() => {
        loadVisibleTimelineCovers();
      }, 500);
    }
  }, [musiciansTimelineData?.musicians?.length]);

  // Add scroll listener for progressive cover loading
  useEffect(() => {
    if (showMusiciansTimeline) {
      const timelineContainer = document.getElementById('timelineContainer');
      if (timelineContainer) {
        const handleScroll = () => {
          // Debounce the scroll handler
          clearTimeout(window.scrollTimeout);
          window.scrollTimeout = setTimeout(() => {
            loadVisibleTimelineCovers();
          }, 200);
        };

        timelineContainer.addEventListener('scroll', handleScroll);
        return () => {
          timelineContainer.removeEventListener('scroll', handleScroll);
          clearTimeout(window.scrollTimeout);
        };
      }
    }
  }, [showMusiciansTimeline, musiciansTimelineData]);

  const cycleAlbumForYear = (musicianId, year, totalAlbums) => {
    console.log(`Cycling albums for musician ${musicianId}, year ${year}, total: ${totalAlbums}`);
    const yearKey = `${musicianId}-${year}`;
    setSelectedAlbumsByYear(prev => {
      const newMap = new Map(prev);
      const currentIndex = newMap.get(yearKey) || 0;
      const nextIndex = (currentIndex + 1) % totalAlbums;
      console.log(`Cycling from index ${currentIndex} to ${nextIndex}`);
      newMap.set(yearKey, nextIndex);
      return newMap;
    });
    
    // Force a re-render by updating the musicians timeline data
    setMusiciansTimelineData(prev => {
      if (!prev) return prev;
      return { ...prev, lastUpdate: Date.now() };
    });
  };

  const updateURL = (newArtist, newAlbum, options = {}) => {
    const params = new URLSearchParams();
    if (newArtist) params.set('artist', newArtist);
    if (newAlbum) params.set('album', newAlbum);
    
    // Include pagination and sort parameters for discography views
    if (!newAlbum && options.includePagination !== false) {
      if (currentPage > 1) params.set('page', currentPage.toString());
      if (albumsPerPage !== 12) params.set('limit', albumsPerPage.toString());
      if (sortOrder !== 'newest') params.set('sort', sortOrder);
    }
    
    const newUrl = params.toString() ? `/?${params.toString()}` : '/';
    router.push(newUrl, undefined, { shallow: true });
  };

  const searchAlbum = async () => {
    // Need either artist or album title
    if (!artistName && !albumTitle.trim()) return;
    
    setLoading(true);
    
    // Clear previous results
    setCurrentAlbum(null);
    setMusicians([]);
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
          
          // Generate Spotify link directly without additional API calls
          const spotifyUrl = MusicBrainzService.generateSpotifyLink(albumTitle, artistName, details);
          setHeaderPlayer({
            spotifyUrl: spotifyUrl,
            albumTitle: albumTitle,
            artistName: artistName
          });
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
          setTrackList(recordings);
          
          // Add track-level artist credits to musicians list
          for (const track of recordings.slice(0, 5)) {
            if (track['artist-credit']) {
              track['artist-credit'].forEach(credit => {
                if (!musicianMap.has(credit.artist.id)) {
                  musicianMap.set(credit.artist.id, {
                    name: credit.artist.name,
                    id: credit.artist.id,
                    role: 'performer'
                  });
                }
              });
            }
          }
          
          // For albums with minimal release-level relationships, check first track's recording relationships
          if (musicianMap.size <= 2 && recordings.length > 0) {
            try {
              const firstTrack = recordings[0];
              if (firstTrack.recording && firstTrack.recording.id) {
                const recordingDetails = await MusicBrainzService.getRecordingDetails(firstTrack.recording.id);
                if (recordingDetails && recordingDetails.relations) {
                  recordingDetails.relations.forEach(relation => {
                    if (relation.artist) {
                      let role = 'performer';
                      
                      if (relation.type === 'instrument') {
                        if (relation.attributes && relation.attributes.length > 0) {
                          role = relation.attributes.map(attr => attr.value || attr).join(', ');
                        } else {
                          role = 'instrument';
                        }
                      } else if (relation.type === 'vocals') {
                        role = 'vocals';
                      }
                      
                      musicianMap.set(relation.artist.id, {
                        name: relation.artist.name,
                        id: relation.artist.id,
                        role: role
                      });
                    }
                  });
                }
              }
            } catch (error) {
              console.error('Error getting recording details for first track:', error);
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
          
          // Albums loaded
        }
      }
    } catch (error) {
      console.error('Error searching album:', error);
    }
    setLoading(false);
  };

  const handleAlbumClick = async (albumTitle, artistName) => {
    console.log(`Navigating to: ${albumTitle} by ${artistName}`);
    
    // Update URL
    updateURL(artistName, albumTitle);
    
    // Update form fields without clearing anything else
    setAlbumTitle(albumTitle);
    setArtistName(artistName);
    
    // Hide discography view when switching to album view
    setArtistDiscography(null);
    
    // Only clear album-specific data, keep the Spotify player playing
    setMusicians([]);
    setLoading(true);
    
    // Search for the new album
    try {
      const releases = await MusicBrainzService.searchRelease(albumTitle, artistName);
      if (releases.length > 0) {
        const release = releases[0];
        
        const details = await MusicBrainzService.getReleaseDetails(release.id);
        if (details) {
          setCurrentAlbum(details);
          
          // Generate Spotify link directly
          const spotifyUrl = MusicBrainzService.generateSpotifyLink(albumTitle, artistName, details);
          setHeaderPlayer({
            spotifyUrl: spotifyUrl,
            albumTitle: albumTitle,
            artistName: artistName
          });
          
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
          setTrackList(recordings);
          
          // Add track-level artist credits to musicians list
          for (const track of recordings.slice(0, 5)) {
            if (track['artist-credit']) {
              track['artist-credit'].forEach(credit => {
                if (!musicianMap.has(credit.artist.id)) {
                  musicianMap.set(credit.artist.id, {
                    name: credit.artist.name,
                    id: credit.artist.id,
                    role: 'performer'
                  });
                }
              });
            }
          }
          
          // For albums with minimal release-level relationships, check first track's recording relationships
          if (musicianMap.size <= 2 && recordings.length > 0) {
            try {
              const firstTrack = recordings[0];
              if (firstTrack.recording && firstTrack.recording.id) {
                const recordingDetails = await MusicBrainzService.getRecordingDetails(firstTrack.recording.id);
                if (recordingDetails && recordingDetails.relations) {
                  recordingDetails.relations.forEach(relation => {
                    if (relation.artist) {
                      let role = 'performer';
                      
                      if (relation.type === 'instrument') {
                        if (relation.attributes && relation.attributes.length > 0) {
                          role = relation.attributes.map(attr => attr.value || attr).join(', ');
                        } else {
                          role = 'instrument';
                        }
                      } else if (relation.type === 'vocals') {
                        role = 'vocals';
                      }
                      
                      musicianMap.set(relation.artist.id, {
                        name: relation.artist.name,
                        id: relation.artist.id,
                        role: role
                      });
                    }
                  });
                }
              }
            } catch (error) {
              console.error('Error getting recording details for first track:', error);
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
          
          // Albums loaded
        }
      }
    } catch (error) {
      console.error('Error searching album:', error);
    }
    setLoading(false);
  };

  const showArtistDiscography = async (artistName) => {
    try {
      // Update URL for discography view
      updateURL(artistName, '');
      
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
        
        // Load covers only for visible albums
        loadCoversForCurrentPage();
      }
    } catch (error) {
      console.error('Error getting artist discography:', error);
    }
  };

  const loadCoversForCurrentPage = async () => {
    if (!artistDiscography) return;
    
    // Get albums for current page
    const sortedAlbums = artistDiscography.albums.sort((a, b) => {
      const aYear = parseInt(a.date.split('-')[0]);
      const bYear = parseInt(b.date.split('-')[0]);
      return sortOrder === 'newest' ? bYear - aYear : aYear - bYear;
    });
    
    const startIndex = (currentPage - 1) * albumsPerPage;
    const endIndex = startIndex + albumsPerPage;
    const visibleAlbums = sortedAlbums.slice(startIndex, endIndex);
    
    // Load covers only for visible albums
    for (const album of visibleAlbums) {
      if (!album.coverArt) {
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
    }
  };

  const showMusiciansTimelinePage = async () => {
    if (!currentAlbum || !musicians.length) return;
    
    setShowMusiciansTimeline(true);
    
    // Initialize timeline data immediately
    const timelineData = {
      currentAlbum: currentAlbum,
      currentYear: parseInt(currentAlbum.date.split('-')[0]),
      musicians: []
    };
    
    setMusiciansTimelineData(timelineData);
    
    // Get discographies for each musician progressively
    for (const musician of musicians) {
      try {
        const releases = await MusicBrainzService.getArtistReleases(musician.id);
        
        // Filter and process albums
        let albums = releases
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
        
        // Always ensure the current album is included and prioritized
        const currentYear = parseInt(currentAlbum.date.split('-')[0]);
        
        // Remove any existing albums from the current year
        albums = albums.filter(album => parseInt(album.date.split('-')[0]) !== currentYear);
        
        // Add the current album for this musician
        albums.push({
          ...currentAlbum,
          // Mark it as the shared album and give it priority
          isSharedAlbum: true,
          priority: true
        });
        
        // Re-sort after adding the current album
        albums.sort((a, b) => {
          const aYear = parseInt(a.date.split('-')[0]);
          const bYear = parseInt(b.date.split('-')[0]);
          return aYear - bYear;
        });
        
        // Add this musician's data immediately
        setMusiciansTimelineData(prev => ({
          ...prev,
          musicians: [...prev.musicians, {
            ...musician,
            albums: albums
          }]
        }));
        
      } catch (error) {
        console.error(`Error getting releases for ${musician.name}:`, error);
        
        // Add musician with empty albums on error so they still appear
        setMusiciansTimelineData(prev => ({
          ...prev,
          musicians: [...prev.musicians, {
            ...musician,
            albums: []
          }]
        }));
      }
    }
    
    // Covers will be loaded automatically via useEffect
  };

  const loadVisibleTimelineCovers = async () => {
    if (!musiciansTimelineData) return;

    const timelineContainer = document.getElementById('timelineContainer');
    if (!timelineContainer) return;

    // Get the visible area bounds - account for scroll position
    const scrollLeft = timelineContainer.scrollLeft;
    const containerWidth = timelineContainer.clientWidth;
    
    // Calculate actual visible area
    const visibleLeft = scrollLeft;
    const visibleRight = scrollLeft + containerWidth;

    // Find all visible album items
    const albumItems = timelineContainer.querySelectorAll(`.${styles.albumItem}`);
    const visibleAlbums = [];

    albumItems.forEach(albumElement => {
      const albumId = albumElement.getAttribute('data-album-id');
      
      // Get the album's position relative to the container
      const albumLeft = albumElement.offsetLeft;
      const albumRight = albumLeft + albumElement.offsetWidth;
      
      // Check if album is visible in the scrolled viewport
      const isVisible = albumRight >= visibleLeft && albumLeft <= visibleRight;
      
      if (isVisible && albumId) {
        // Find the corresponding album data
        const musicianRow = albumElement.closest(`.${styles.musicianRow}`);
        const musicianId = musicianRow?.getAttribute('data-musician-id');
        
        if (musicianId) {
          const musician = musiciansTimelineData.musicians.find(m => m.id === musicianId);
          if (musician) {
            const album = musician.albums.find(a => a.id === albumId);
            if (album && !album.coverArt) {
              visibleAlbums.push({ musician, album });
            }
          }
        }
      }
    });

    console.log(`Loading covers for ${visibleAlbums.length} visible albums`);

    // Load covers for visible albums
    for (const { musician, album } of visibleAlbums) {
      try {
        const coverArtUrl = await MusicBrainzService.getCoverArtUrl(album.id);
        if (coverArtUrl) {
          console.log(`Got cover for visible album: ${album.title}`);
          // Update the album with cover art
          setMusiciansTimelineData(prev => {
            if (!prev) return prev;
            
            const updatedMusicians = prev.musicians.map(m => {
              if (m.id === musician.id) {
                return {
                  ...m,
                  albums: m.albums.map(a => 
                    a.id === album.id ? { ...a, coverArt: coverArtUrl } : a
                  )
                };
              }
              return m;
            });
            
            return {
              ...prev,
              musicians: updatedMusicians
            };
          });
        }
      } catch (error) {
        console.log(`Could not load cover for ${album.title}`);
      }
    }
  };

  const loadTimelineCovers = async (timelineData) => {
    console.log('Loading covers for timeline data:', timelineData);
    // Load covers for all albums in the timeline
    for (const musician of timelineData.musicians) {
      console.log(`Loading covers for ${musician.name}, ${musician.albums.length} albums`);
      for (const album of musician.albums) {
        if (!album.coverArt) {
          try {
            console.log(`Fetching cover for ${album.title}`);
            const coverArtUrl = await MusicBrainzService.getCoverArtUrl(album.id);
            if (coverArtUrl) {
              console.log(`Got cover URL for ${album.title}: ${coverArtUrl}`);
              // Update the album with cover art
              setMusiciansTimelineData(prev => {
                if (!prev) return prev;
                
                const updatedMusicians = prev.musicians.map(m => {
                  if (m.id === musician.id) {
                    return {
                      ...m,
                      albums: m.albums.map(a => 
                        a.id === album.id ? { ...a, coverArt: coverArtUrl } : a
                      )
                    };
                  }
                  return m;
                });
                
                return {
                  ...prev,
                  musicians: updatedMusicians
                };
              });
            }
          } catch (error) {
            console.log(`Could not load cover for ${album.title}`);
          }
        }
      }
    }
  };

  const positionAlbumsByYear = () => {
    if (!musiciansTimelineData) return;

    const albumRows = document.querySelectorAll(`.${styles.albumsRow}`);
    if (albumRows.length === 0) return;

    // Find all years across all musicians
    const allYears = new Set();
    musiciansTimelineData.musicians.forEach(musician => {
      musician.albums.forEach(album => {
        const year = parseInt(album.date.split('-')[0]);
        allYears.add(year);
      });
    });

    const sortedYears = Array.from(allYears).sort((a, b) => a - b);
    const minYear = sortedYears[0];
    const maxYear = sortedYears[sortedYears.length - 1];
    const yearRange = maxYear - minYear + 1;
    const basePixelsPerYear = 160;
    // Scale spacing with zoom, ensuring albums don't overlap
    const pixelsPerYear = basePixelsPerYear * timelineZoom;
    const currentYear = musiciansTimelineData.currentYear;

    // Update CSS custom property for album cover size
    const timelineElement = document.querySelector(`.${styles.musiciansTimeline}`);
    if (timelineElement) {
      timelineElement.style.setProperty('--album-cover-size', `${120 * timelineZoom}px`);
    }

    albumRows.forEach(row => {
      const albums = row.querySelectorAll(`.${styles.albumItem}`);
      
      row.style.position = 'relative';
      row.style.minWidth = `${yearRange * pixelsPerYear}px`;
      row.style.width = `${yearRange * pixelsPerYear}px`;
      
      // Ensure the parent musician row also extends
      const musicianRow = row.closest(`.${styles.musicianRow}`);
      if (musicianRow) {
        musicianRow.style.minWidth = `${yearRange * pixelsPerYear + 240}px`;
        musicianRow.style.width = `${yearRange * pixelsPerYear + 240}px`;
      }
      
      // Group albums by year for this row
      const albumsByYear = new Map();
      albums.forEach(album => {
        const year = parseInt(album.getAttribute('data-year'));
        const albumId = album.getAttribute('data-album-id');
        if (!albumsByYear.has(year)) {
          albumsByYear.set(year, []);
        }
        albumsByYear.get(year).push({element: album, albumId: albumId});
      });
      
      // Position albums - show selected album per year, hide others
      albumsByYear.forEach((yearAlbums, year) => {
        const basePosition = (year - minYear) * pixelsPerYear;
        const musicianId = row.closest('.musicianRow')?.getAttribute('data-musician-id');
        const yearKey = `${musicianId}-${year}`;
        const selectedIndex = selectedAlbumsByYear.get(yearKey) || 0;
        
        console.log(`Positioning year ${year}, musician ${musicianId}, selected index: ${selectedIndex}, total albums: ${yearAlbums.length}`);
        
        yearAlbums.forEach((albumData, index) => {
          const album = albumData.element;
          if (index === selectedIndex) {
            // Show selected album
            album.style.position = 'absolute';
            album.style.left = `${basePosition}px`;
            album.style.top = '0';
            album.style.display = 'flex';
            album.style.zIndex = '1';
            console.log(`Showing album at index ${index} for year ${year}`);
            
            // Add multiple album indicator and click handler
            if (yearAlbums.length > 1) {
              album.setAttribute('data-multiple-albums', yearAlbums.length.toString());
              album.setAttribute('data-current-album', (selectedIndex + 1).toString());
              album.classList.add('has-multiple-albums');
            } else {
              album.removeAttribute('data-multiple-albums');
              album.removeAttribute('data-current-album');
              album.classList.remove('has-multiple-albums');
            }
          } else {
            // Hide other albums for same year
            album.style.display = 'none';
            console.log(`Hiding album at index ${index} for year ${year}`);
          }
        });
      });
    });

    // Only auto-scroll to center on initial load
    const timelineContainer = document.getElementById('timelineContainer');
    if (timelineContainer && !timelineInitialized) {
      const currentYearPosition = (currentYear - minYear) * pixelsPerYear;
      const containerWidth = timelineContainer.clientWidth;
      const scrollPosition = currentYearPosition - (containerWidth / 2) + (60 * timelineZoom);
      
      timelineContainer.scrollLeft = Math.max(0, scrollPosition);
    }
  };

  const updateLayoutForZoom = () => {
    if (!musiciansTimelineData) return;

    const albumRows = document.querySelectorAll(`.${styles.albumsRow}`);
    if (albumRows.length === 0) return;

    // Find all years across all musicians
    const allYears = new Set();
    musiciansTimelineData.musicians.forEach(musician => {
      musician.albums.forEach(album => {
        const year = parseInt(album.date.split('-')[0]);
        allYears.add(year);
      });
    });

    const sortedYears = Array.from(allYears).sort((a, b) => a - b);
    const minYear = sortedYears[0];
    const maxYear = sortedYears[sortedYears.length - 1];
    const yearRange = maxYear - minYear + 1;
    const basePixelsPerYear = 160;
    const pixelsPerYear = basePixelsPerYear * timelineZoom;

    // Update spacing without auto-scrolling
    albumRows.forEach(row => {
      const albums = row.querySelectorAll(`.${styles.albumItem}`);
      
      row.style.minWidth = `${yearRange * pixelsPerYear}px`;
      row.style.width = `${yearRange * pixelsPerYear}px`;
      
      // Ensure the parent musician row also extends
      const musicianRow = row.closest(`.${styles.musicianRow}`);
      if (musicianRow) {
        musicianRow.style.minWidth = `${yearRange * pixelsPerYear + 240}px`;
        musicianRow.style.width = `${yearRange * pixelsPerYear + 240}px`;
      }
      
      // Group albums by year for this row
      const albumsByYear = new Map();
      albums.forEach(album => {
        const year = parseInt(album.getAttribute('data-year'));
        const albumId = album.getAttribute('data-album-id');
        if (!albumsByYear.has(year)) {
          albumsByYear.set(year, []);
        }
        albumsByYear.get(year).push({element: album, albumId: albumId});
      });
      
      // Update positions - show selected album per year, hide others
      albumsByYear.forEach((yearAlbums, year) => {
        const basePosition = (year - minYear) * pixelsPerYear;
        const musicianId = row.closest('.musicianRow')?.getAttribute('data-musician-id');
        const yearKey = `${musicianId}-${year}`;
        const selectedIndex = selectedAlbumsByYear.get(yearKey) || 0;
        
        yearAlbums.forEach((albumData, index) => {
          const album = albumData.element;
          if (index === selectedIndex) {
            // Show selected album
            album.style.left = `${basePosition}px`;
            album.style.top = '0';
            album.style.display = 'flex';
            album.style.zIndex = '1';
            
            // Add multiple album indicator
            if (yearAlbums.length > 1) {
              album.setAttribute('data-multiple-albums', yearAlbums.length.toString());
              album.setAttribute('data-current-album', (selectedIndex + 1).toString());
              album.classList.add('has-multiple-albums');
            } else {
              album.removeAttribute('data-multiple-albums');
              album.removeAttribute('data-current-album');
              album.classList.remove('has-multiple-albums');
            }
          } else {
            // Hide other albums for same year
            album.style.display = 'none';
          }
        });
      });
    });

    // Update year scale
    const yearScale = document.querySelector(`.${styles.yearScale}`);
    if (yearScale) {
      yearScale.style.minWidth = `${yearRange * pixelsPerYear}px`;
      
      const yearMarkers = yearScale.querySelectorAll(`.${styles.yearMarker}`);
      yearMarkers.forEach(marker => {
        const year = parseInt(marker.textContent);
        marker.style.left = `${240 + (year - minYear) * pixelsPerYear + (120 * timelineZoom / 2) + 20}px`;
      });
    }
  };

  const renderYearScale = () => {
    if (!musiciansTimelineData) return;

    const yearScale = document.querySelector(`.${styles.yearScale}`);
    if (!yearScale) return;

    // Find all years across all musicians
    const allYears = new Set();
    musiciansTimelineData.musicians.forEach(musician => {
      musician.albums.forEach(album => {
        const year = parseInt(album.date.split('-')[0]);
        allYears.add(year);
      });
    });

    const sortedYears = Array.from(allYears).sort((a, b) => a - b);
    const minYear = sortedYears[0];
    const maxYear = sortedYears[sortedYears.length - 1];
    const yearRange = maxYear - minYear + 1;
    const pixelsPerYear = 160 * timelineZoom;
    const currentYear = musiciansTimelineData.currentYear;

    yearScale.style.position = 'relative';
    yearScale.style.height = '40px';
    yearScale.style.minWidth = `${yearRange * pixelsPerYear}px`;
    yearScale.innerHTML = '';

    // Add year markers
    for (let year = minYear; year <= maxYear; year++) {
      const yearMarker = document.createElement('div');
      yearMarker.className = styles.yearMarker;
      yearMarker.textContent = year.toString();
      yearMarker.style.position = 'absolute';
      yearMarker.style.left = `${240 + (year - minYear) * pixelsPerYear + (120 * timelineZoom / 2) + 20}px`;
      yearMarker.style.top = '50%';
      yearMarker.style.color = year === currentYear ? '#1db954' : '#ccc';
      yearMarker.style.fontWeight = year === currentYear ? 'bold' : 'normal';
      yearMarker.style.fontSize = '1.2rem';
      yearMarker.style.transform = 'translate(-50%, -50%)';
      
      if (year === currentYear) {
        yearMarker.style.textShadow = '0 0 8px #1db954';
      }
      
      yearScale.appendChild(yearMarker);
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
        
        // Load covers only for visible albums
        loadCoversForCurrentPage();
      }
    } catch (error) {
      console.error('Error searching by title:', error);
    }
  };

  console.log('Render state:', { showMusiciansTimeline, currentAlbum: !!currentAlbum, artistDiscography: !!artistDiscography });
  
  return (
    <div className={styles.albumExplorer}>
      <div className={styles.searchSection}>
        <h1 
          onClick={() => {
            setArtistName('Miles Davis');
            setAlbumTitle('Kind of Blue');
            setCurrentPage(1);
            setAlbumsPerPage(12);
            setSortOrder('newest');
            setArtistDiscography(null);
            router.push('/', undefined, { shallow: true });
          }}
          style={{ cursor: 'pointer' }}
          className={styles.homeTitle}
        >
          Careers in Music
        </h1>
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
          <button onClick={() => {
            updateURL(artistName, albumTitle);
            searchAlbum();
          }} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
        
        {(headerPlayer || currentAlbum) && (
          <div className={`${styles.headerPlayer} headerPlayer`}>
            {headerPlayer ? (
              <SpotifyPlayer 
                spotifyUrl={headerPlayer.spotifyUrl}
                albumTitle={headerPlayer.albumTitle}
                artistName={headerPlayer.artistName}
              />
            ) : currentAlbum ? (
              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <a 
                  href={MusicBrainzService.generateSpotifyLink(currentAlbum.title, artistName, currentAlbum)}
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

      {showMusiciansTimeline && musiciansTimelineData && (
        <div className={styles.musiciansTimeline}>
          <div className={styles.timelineHeader}>
            <button 
              onClick={() => {
                setShowMusiciansTimeline(false);
                setTimelineInitialized(false);
              }}
              className={styles.backButton}
            >
              ← Back to {currentAlbum?.title || 'Album'}
            </button>
            <h2>Musicians Timeline - {currentAlbum?.title || 'Album'} ({musiciansTimelineData.currentYear})</h2>
            
            <div className={styles.zoomControls}>
              <span className={styles.zoomLabel}>Zoom:</span>
              <button 
                onClick={() => setTimelineZoom(prev => Math.max(0.5, prev - 0.25))}
                className={styles.zoomButton}
                disabled={timelineZoom <= 0.5}
              >
                -
              </button>
              <span className={styles.zoomLevel}>{Math.round(timelineZoom * 100)}%</span>
              <button 
                onClick={() => setTimelineZoom(prev => Math.min(3, prev + 0.25))}
                className={styles.zoomButton}
                disabled={timelineZoom >= 3}
              >
                +
              </button>
              <button 
                onClick={() => setTimelineZoom(1)}
                className={styles.resetZoomButton}
              >
                Reset
              </button>
            </div>
          </div>
          
          <div className={styles.timelineContainer} id="timelineContainer">
            {/* Year scale */}
            <div className={styles.yearScale} ref={el => {
              if (el) {
                setTimeout(() => renderYearScale(), 100);
              }
            }}></div>
            
            {musiciansTimelineData.musicians.map((musician, index) => (
              <div key={musician.id} className={styles.musicianRow} data-musician-id={musician.id}>
                <div className={styles.musicianLabel}>
                  <h3>{musician.name}</h3>
                  {musician.role && <span className={styles.role}>({musician.role})</span>}
                  {musician.albums.length === 0 && (
                    <div className={styles.loadingIndicator}>Loading...</div>
                  )}
                </div>
                <div className={styles.albumsRow} ref={el => {
                  if (el && index === 0) {
                    // Position albums by year for synchronized scrolling
                    setTimeout(() => positionAlbumsByYear(), 100);
                  }
                }}>
                  {(() => {
                    // Group albums by year first
                    const albumsByYear = new Map();
                    musician.albums.forEach((album, albumIndex) => {
                      const year = parseInt(album.date.split('-')[0]);
                      if (!albumsByYear.has(year)) {
                        albumsByYear.set(year, []);
                      }
                      albumsByYear.get(year).push({ album, albumIndex });
                    });
                    
                    // For each year, only render the selected album
                    const visibleAlbums = [];
                    albumsByYear.forEach((yearAlbums, year) => {
                      const yearKey = `${musician.id}-${year}`;
                      const selectedIndex = selectedAlbumsByYear.get(yearKey) || 0;
                      const selectedAlbumData = yearAlbums[selectedIndex] || yearAlbums[0];
                      if (selectedAlbumData) {
                        visibleAlbums.push({ ...selectedAlbumData, year, totalInYear: yearAlbums.length });
                      }
                    });
                    
                    return visibleAlbums.map(({ album, albumIndex, year, totalInYear }) => {
                      const isCurrentAlbum = currentAlbum && album.title === currentAlbum.title && year === musiciansTimelineData.currentYear;
                    
                    return (
                      <div 
                        key={album.id} 
                        className={`${styles.albumItem} ${isCurrentAlbum ? styles.currentAlbumItem : ''}`}
                        data-album-id={album.id}
                        onClick={(e) => {
                          if (!isCurrentAlbum) {
                            // Exit timeline and navigate to album
                            setShowMusiciansTimeline(false);
                            setTimelineInitialized(false);
                            handleAlbumClick(album.title, musician.name);
                          }
                        }}
                        onContextMenu={(e) => {
                          // Right-click cycles through albums if multiple in same year
                          if (totalInYear > 1) {
                            e.preventDefault();
                            e.stopPropagation();
                            cycleAlbumForYear(musician.id, year, totalInYear);
                          }
                        }}
                        style={{ 
                          cursor: isCurrentAlbum ? 'default' : 'pointer',
                          opacity: isCurrentAlbum ? 1 : 0.8
                        }}
                        data-year={year}
                        title={`${album.title} (${year})`}
                      >
                        <div className={styles.albumCoverSmall}>
                          {album.coverArt ? (
                            <img src={album.coverArt} alt={`${album.title} cover`} />
                          ) : (
                            <div className={styles.placeholderCover}>{album.title.charAt(0)}</div>
                          )}
                        </div>
                        <div className={styles.albumInfo}>
                          <div className={styles.albumTitle}>{album.title}</div>
                          <div className={styles.albumYear}>{year}</div>
                        </div>
                        {totalInYear > 1 && (
                          <div 
                            className={styles.multipleAlbumsBadge}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              cycleAlbumForYear(musician.id, year, totalInYear);
                            }}
                            title={`Click to cycle through ${totalInYear} albums from ${year}`}
                          >
                            {(() => {
                              const yearKey = `${musician.id}-${year}`;
                              const selectedIndex = selectedAlbumsByYear.get(yearKey) || 0;
                              return `${selectedIndex + 1}/${totalInYear}`;
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentAlbum && !showMusiciansTimeline && (
        <div className={styles.albumDisplayNoSidebars}>
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
                    href={MusicBrainzService.generateSpotifyLink(currentAlbum.title, artistName, currentAlbum)}
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
                <h3 
                  onClick={() => showMusiciansTimelinePage()}
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  title="View musicians timeline"
                >
                  Musicians on this album:
                </h3>
                <ul className={styles.musiciansList}>
                  {musicians.map((musician, index) => (
                    <li key={index} className={styles.musician}>
                      <div 
                        className={styles.musicianName}
                        onClick={() => {
                          updateURL(musician.name, '');
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
              
              {trackList.length > 0 && (
                <div className={styles.trackListSection}>
                  <h3>Songs on this album:</h3>
                  <ul className={styles.trackList}>
                    {trackList.map((track, index) => (
                      <li key={index} className={styles.trackItem}>
                        <div className={styles.trackNumber}>{track.position || index + 1}</div>
                        <div className={styles.trackInfo}>
                          <div className={styles.trackTitle}>{track.title}</div>
                          {track.length && (
                            <div className={styles.trackDuration}>
                              {Math.floor(track.length / 60000)}:{((track.length % 60000) / 1000).toFixed(0).padStart(2, '0')}
                            </div>
                          )}
                        </div>
                        <div className={styles.trackSpotify}>
                          <button 
                            onClick={() => {
                              // Since Spotify embed can't play individual tracks directly,
                              // we'll ensure the album player is visible and scroll to it
                              if (!headerPlayer) {
                                // If no player is active, set up the album player
                                const spotifyUrl = MusicBrainzService.generateSpotifyLink(currentAlbum.title, artistName, currentAlbum);
                                setHeaderPlayer({
                                  spotifyUrl: spotifyUrl,
                                  albumTitle: currentAlbum.title,
                                  artistName: artistName
                                });
                              }
                              // Scroll to the player
                              const playerElement = document.querySelector('.headerPlayer, .spotifyPlayer');
                              if (playerElement) {
                                playerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                            }}
                            className={styles.spotifyTrackLink}
                            title={`Play album (track ${track.position || index + 1}: ${track.title})`}
                          >
                            ▶️
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
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
                  const newLimit = parseInt(e.target.value);
                  setAlbumsPerPage(newLimit);
                  setCurrentPage(1);
                  // Update URL with new pagination settings
                  updateURL(artistDiscography.artist.name.startsWith('Search results') ? '' : artistDiscography.artist.name, '');
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
                  setCurrentPage(1);
                  // Update URL with new sort settings
                  updateURL(artistDiscography.artist.name.startsWith('Search results') ? '' : artistDiscography.artist.name, '');
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
                onClick={() => {
                  const newPage = Math.max(1, currentPage - 1);
                  setCurrentPage(newPage);
                  updateURL(artistDiscography.artist.name.startsWith('Search results') ? '' : artistDiscography.artist.name, '');
                }}
                disabled={currentPage === 1}
                className={styles.pageButton}
              >
                Previous
              </button>
              
              <span className={styles.pageInfo}>
                Page {currentPage} of {Math.ceil(artistDiscography.albums.length / albumsPerPage)}
              </span>
              
              <button 
                onClick={() => {
                  const newPage = Math.min(Math.ceil(artistDiscography.albums.length / albumsPerPage), currentPage + 1);
                  setCurrentPage(newPage);
                  updateURL(artistDiscography.artist.name.startsWith('Search results') ? '' : artistDiscography.artist.name, '');
                }}
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