import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, RefreshCw, GitBranch, Settings, X, GripVertical, Copy, Folder, FolderGit2, ChevronUp, File, History } from 'lucide-react';
import * as Diff2Html from 'diff2html';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult, DroppableProps } from '@hello-pangea/dnd';
import pixelmatch from 'pixelmatch';
import 'diff2html/bundles/css/diff2html.min.css';
import './App.css';
import LiquidGreen from './components/LiquidGreen';
import GitGraph from './components/GitGraph';

// Custom Droppable to handle React mounting
export const StrictModeDroppable = ({ children, ...props }: DroppableProps) => {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const animation = requestAnimationFrame(() => setEnabled(true));
    return () => {
      cancelAnimationFrame(animation);
      setEnabled(false);
    };
  }, []);
  if (!enabled) {
    return null;
  }
  return <Droppable {...props}>{children}</Droppable>;
};

function splitFilePath(filePath: string): { dir: string; name: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) {
    return { dir: '', name: filePath };
  }
  return {
    dir: filePath.substring(0, lastSlash + 1),
    name: filePath.substring(lastSlash + 1),
  };
}

const isImageFile = (filename: string | null) => {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
};

const ImageDiffView = ({ repoId, file, lastUpdate }: { repoId: string; file: string; lastUpdate?: string }) => {
  const timestamp = lastUpdate ? new Date(lastUpdate).getTime() : Date.now();
  const beforeUrl = `http://localhost:3001/api/repositories/${repoId}/content?file=${encodeURIComponent(file)}&version=HEAD&t=${timestamp}`;
  const afterUrl = `http://localhost:3001/api/repositories/${repoId}/content?file=${encodeURIComponent(file)}&version=working&t=${timestamp}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [beforeExists, setBeforeExists] = useState(true);
  const [afterExists, setAfterExists] = useState(true);
  const [modalImage, setModalImage] = useState<{ url?: string; canvas?: HTMLCanvasElement; title: string } | null>(null);

  useEffect(() => {
    const loadImage = (url: string): Promise<HTMLImageElement | null> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null); // Return null on error (404, etc)
        img.src = url;
      });
    };

    const runDiff = async () => {
      try {
        const [img1, img2] = await Promise.all([loadImage(beforeUrl), loadImage(afterUrl)]);
        
        setBeforeExists(!!img1);
        setAfterExists(!!img2);

        if (!img1 || !img2) {
          setError(null); 
          return;
        }

        if (img1.width !== img2.width || img1.height !== img2.height) {
          setError(`Dimensions mismatch: ${img1.width}x${img1.height} vs ${img2.width}x${img2.height}. Visual diff disabled.`);
          return;
        }

        const canvas = canvasRef.current;
        if (!canvas) return;

        const { width, height } = img1;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const c1 = document.createElement('canvas');
        const c2 = document.createElement('canvas');
        c1.width = c2.width = width;
        c1.height = c2.height = height;
        const ctx1 = c1.getContext('2d')!;
        const ctx2 = c2.getContext('2d')!;
        
        ctx1.drawImage(img1, 0, 0);
        ctx2.drawImage(img2, 0, 0);

        const imgData1 = ctx1.getImageData(0, 0, width, height);
        const imgData2 = ctx2.getImageData(0, 0, width, height);
        const diffData = ctx.createImageData(width, height);

        pixelmatch(imgData1.data, imgData2.data, diffData.data, width, height, { threshold: 0.1 });
        ctx.putImageData(diffData, 0, 0);
        setError(null);
      } catch (err: any) {
        console.error('Image diff error:', err);
        setError(err.message || 'Failed to generate visual diff.');
      }
    };

    runDiff();
  }, [beforeUrl, afterUrl]);

  return (
    <div className="image-diff-container">
      <div className="image-diff-grid">
        <div className="image-diff-item">
          <h5>Before (HEAD)</h5>
          <div className="image-wrapper">
            {beforeExists ? (
              <img src={beforeUrl} alt="Before" onClick={() => setModalImage({ url: beforeUrl, title: 'Before (HEAD)' })} />
            ) : (
              <div className="no-image-placeholder">New File</div>
            )}
          </div>
        </div>
        <div className="image-diff-item">
          <h5>After (Working Tree)</h5>
          <div className="image-wrapper">
            {afterExists ? (
              <img src={afterUrl} alt="After" onClick={() => setModalImage({ url: afterUrl, title: 'After (Working Tree)' })} />
            ) : (
              <div className="no-image-placeholder">Deleted File</div>
            )}
          </div>
        </div>
        <div className="image-diff-item">
          <h5>Visual Diff</h5>
          <div className="image-wrapper">
            {beforeExists && afterExists ? (
              <canvas 
                ref={canvasRef} 
                onClick={() => {
                  const newCanvas = document.createElement('canvas');
                  newCanvas.width = canvasRef.current!.width;
                  newCanvas.height = canvasRef.current!.height;
                  newCanvas.getContext('2d')!.drawImage(canvasRef.current!, 0, 0);
                  setModalImage({ canvas: newCanvas, title: 'Visual Diff' });
                }} 
              />
            ) : (
              <div className="no-image-placeholder">N/A</div>
            )}
          </div>
        </div>
      </div>
      {error && <div className="diff-error">{error}</div>}

      {modalImage && (
        <div className="image-modal-overlay" onClick={() => setModalImage(null)}>
          <div className="image-modal-content" onClick={e => e.stopPropagation()}>
            <span className="image-modal-title">{modalImage.title}</span>
            {modalImage.url ? (
              <img src={modalImage.url} alt={modalImage.title} />
            ) : modalImage.canvas ? (
              <div ref={el => {
                if (el && modalImage.canvas && !el.hasChildNodes()) {
                  el.appendChild(modalImage.canvas);
                }
              }} />
            ) : null}
            <button className="close-modal" onClick={() => setModalImage(null)}>
              <X size={32} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface Repository {
  id: string;
  name: string;
  path: string;
  pollInterval: number;
  status?: {
    branch: string;
    modifiedFiles: string[];
    hasChanges: boolean;
    lastUpdate: string;
  };
}

const DiffView = ({ diff }: { diff: string }) => {
  const files = Diff2Html.parse(diff);
  
  if (files.length === 0) return null;

  return (
    <div className="diff-files-container">
      {files.map((file, idx) => {
        const fileDiffHtml = Diff2Html.html([file], {
          drawFileList: false,
          matching: 'lines',
          outputFormat: 'side-by-side',
          renderNothingWhenEmpty: true,
        });

        return (
          <div key={idx} className="diff-file-section">
            <header className="liquid-glass-header">
              <div className="liquid-glass-bg"></div>
              <div className="header-content">
                <File size={16} className="file-icon" />
                <span className="file-name">{file.newName === '/dev/null' ? file.oldName : file.newName}</span>
                <button
                  className="copy-filename-btn"
                  title="Copy path"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(file.newName === '/dev/null' ? file.oldName : file.newName);
                  }}
                >
                  <Copy size={12} />
                </button>
              </div>
            </header>
            <div 
              className="diff-content"
              dangerouslySetInnerHTML={{ __html: fileDiffHtml }} 
            />
          </div>
        );
      })}
    </div>
  );
};

function App() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [newRepoPath, setNewRepoPath] = useState('');
  const [browseMode, setBrowseMode] = useState(true);
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<Array<{
    name: string; path: string; isGitRepo: boolean;
  }>>([]);
  const [browseParentPath, setBrowseParentPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [activeDiff, setActiveDiff] = useState<string>('');
  const [globalInterval, setGlobalInterval] = useState(30);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [showHistory, setShowHistory] = useState(false);
  const [diffRange, setDiffRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [rangeModifiedFiles, setRangeModifiedFiles] = useState<string[]>([]);
  const isResizing = useRef(false);

  const activeRepo = repositories.find(r => r.id === activeRepoId);

  useEffect(() => {
    fetchRepos();
    const interval = setInterval(fetchRepos, 60000); // 1 min background check
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeRepoId) {
      updateActiveRepoStatus();
      const interval = setInterval(updateActiveRepoStatus, globalInterval * 1000); 
      return () => clearInterval(interval);
    }
  }, [activeRepoId, globalInterval]);

  useEffect(() => {
    if (activeRepoId) {
      fetchDiff(activeRepoId, selectedFile, diffRange);
    }
  }, [activeRepoId, selectedFile, diffRange]);

  useEffect(() => {
    if (activeRepoId) {
      fetchRangeFiles(activeRepoId, diffRange);
    }
  }, [activeRepoId, diffRange]);

  const startResizing = () => {
    isResizing.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = Math.max(200, Math.min(600, e.clientX));
    setSidebarWidth(newWidth);
  };

  const stopResizing = () => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(repositories);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setRepositories(items);

    try {
      await fetch('http://localhost:3001/api/repositories/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositoryIds: items.map(r => r.id) })
      });
    } catch (err) {
      console.error('Failed to save reordered repos', err);
    }
  };

  const fetchRepos = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/repositories');
      const data = await res.json();
      setRepositories(data);
      data.forEach((repo: Repository) => updateStatus(repo.id));
    } catch (err) {
      console.error('Failed to fetch repos', err);
    }
  };

  const updateStatus = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:3001/api/repositories/${id}/status`);
      const status = await res.json();
      setRepositories(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  const updateActiveRepoStatus = () => {
    if (activeRepoId) updateStatus(activeRepoId);
  };

  const fetchRangeFiles = async (id: string, range = diffRange) => {
    try {
      const params = new URLSearchParams();
      if (range.from) params.append('from', range.from);
      if (range.to) params.append('to', range.to);
      
      const res = await fetch(`http://localhost:3001/api/repositories/${id}/files?${params.toString()}`);
      const data = await res.json();
      setRangeModifiedFiles(data.files || []);
    } catch (err) {
      console.error('Failed to fetch range files', err);
    }
  };

  const fetchDiff = async (id: string, file: string | null, range = diffRange) => {
    try {
      const params = new URLSearchParams();
      if (file) params.append('file', file);
      if (range.from) params.append('from', range.from);
      if (range.to) params.append('to', range.to);
      
      const url = `http://localhost:3001/api/repositories/${id}/diff?${params.toString()}`;
      const res = await fetch(url);
      const data = await res.json();
      setActiveDiff(data.diff);
    } catch (err) {
      console.error('Failed to fetch diff', err);
    }
  };

  const submitAddRepo = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newRepoPath })
      });
      if (res.ok) {
        setNewRepoPath('');
        setShowAddModal(false);
        fetchRepos();
      }
    } catch (err) {
      console.error('Failed to add repo', err);
    }
  };

  const handleAddRepo = (e: React.FormEvent) => {
    e.preventDefault();
    submitAddRepo();
  };

  const fetchBrowseEntries = async (dir?: string, hidden?: boolean) => {
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const params = new URLSearchParams();
      if (dir) params.set('dir', dir);
      params.set('showHidden', String(hidden ?? showHidden));
      const res = await fetch(`http://localhost:3001/api/browse?${params}`);
      if (!res.ok) {
        const data = await res.json();
        setBrowseError(data.error || 'Failed to browse');
        return;
      }
      const data = await res.json();
      setBrowsePath(data.currentPath);
      setBrowseEntries(data.entries);
      setBrowseParentPath(data.parentPath);
    } catch (err) {
      setBrowseError('Failed to connect to server');
    } finally {
      setBrowseLoading(false);
    }
  };

  const openAddModal = () => {
    setShowAddModal(true);
    setBrowseMode(true);
    setNewRepoPath('');
    setBrowseError('');
    fetchBrowseEntries();
  };

  const handleDeleteRepo = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to remove this repository?')) return;
    try {
      const res = await fetch(`http://localhost:3001/api/repositories/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        if (activeRepoId === id) setActiveRepoId(null);
        fetchRepos();
      }
    } catch (err) {
      console.error('Failed to delete repo', err);
    }
  };

  const filteredFiles = (diffRange.from ? rangeModifiedFiles : activeRepo?.status?.modifiedFiles || []).filter(f => 
    f.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="app-container">
      <aside className="sidebar" style={{ width: `${sidebarWidth}px`, flex: 'none' }}>
        <div className="sidebar-header">
          <h2 
            className="logo" 
            onClick={() => {
              setActiveRepoId(null);
              setSelectedFile(null);
            }}
          >
            ⛳️ Duff
          </h2>
          <button onClick={openAddModal} className="icon-btn" title="Add Repository">
            <Plus size={20} />
          </button>
        </div>
        
        <DragDropContext onDragEnd={onDragEnd}>
          <StrictModeDroppable droppableId="repositories">
            {(provided) => (
              <div 
                className="repo-list" 
                {...provided.droppableProps} 
                ref={provided.innerRef}
              >
                {repositories.map((repo, index) => (
                  <Draggable key={repo.id} draggableId={repo.id} index={index}>
                    {(provided, snapshot) => (
                      <div 
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`repo-item ${activeRepoId === repo.id ? 'active' : ''} ${snapshot.isDragging ? 'dragging' : ''}`}
                        onClick={() => {
                          setActiveRepoId(repo.id);
                          setSelectedFile(null);
                        }}
                      >
                        <div className="repo-main-content">
                          <div className="drag-handle" {...provided.dragHandleProps}>
                            <GripVertical size={16} />
                          </div>
                          <div className="repo-info-container">
                            <div className="repo-info">
                              <span className="repo-name">{repo.name}</span>
                              <div className="repo-actions">
                                {repo.status?.hasChanges && <span className="change-badge"></span>}
                                <button onClick={(e) => handleDeleteRepo(repo.id, e)} className="delete-btn icon-btn" title="Delete">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                            <div className="repo-details">
                              <span className="repo-path">{repo.path}</span>
                              <span className="repo-branch">
                                <GitBranch size={12} /> {repo.status?.branch || '...'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </StrictModeDroppable>
        </DragDropContext>

        <div className="sidebar-footer" onClick={() => setShowSettingsModal(true)}>
          <Settings size={20} />
          <span>Config</span>
        </div>
      </aside>

      <div className="resizer" onMouseDown={startResizing} />

      {activeRepoId && (
        <GitGraph 
          repoId={activeRepoId} 
          isVisible={showHistory} 
          onSelectRange={(from, to) => setDiffRange({ from, to })} 
        />
      )}

      <main className="main-content">
        {activeRepo ? (
          <>
            <header className="main-header">
              <div className="header-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button 
                    className={`icon-btn ${showHistory ? 'active' : ''}`} 
                    onClick={() => setShowHistory(!showHistory)}
                    title="Toggle History"
                  >
                    <History size={18} />
                  </button>
                  <h3>{activeRepo.name} <span className="branch-label">({activeRepo.status?.branch})</span></h3>
                </div>
                <div className="header-meta">
                  <span>Last updated: {activeRepo.status?.lastUpdate ? new Date(activeRepo.status.lastUpdate).toLocaleTimeString() : '...'}</span>
                  <button onClick={updateActiveRepoStatus} className="icon-btn"><RefreshCw size={16} /></button>
                </div>
              </div>
              
              <div className="search-bar">
                <Search size={18} />
                <input 
                  type="text" 
                  placeholder="Filter files..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </header>

            <div className="content-body">
              <div className="file-list">
                <h4>Modified Files</h4>
                <ul>
                  <li 
                    className={selectedFile === null ? 'selected' : ''} 
                    onClick={() => setSelectedFile(null)}
                  >
                    All Changes
                  </li>
                  {filteredFiles.map(file => {
                    const { dir, name } = splitFilePath(file);
                    return (
                      <li
                        key={file}
                        className={selectedFile === file ? 'selected' : ''}
                        onClick={() => setSelectedFile(file)}
                      >
                        <span className="file-path-text">
                          {dir && <span className="file-dir">{dir}</span>}
                          <span className="file-name">{name}</span>
                        </span>
                        <button
                          className="copy-filename-btn"
                          title={`Copy filename: ${name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(name);
                          }}
                        >
                          <Copy size={12} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="diff-viewer">
                {selectedFile && isImageFile(selectedFile) && activeRepoId ? (
                  <ImageDiffView 
                    repoId={activeRepoId} 
                    file={selectedFile} 
                    lastUpdate={activeRepo?.status?.lastUpdate} 
                  />
                ) : activeDiff ? (
                  <DiffView diff={activeDiff} />
                ) : (
                  <div className="no-diff">
                    <div className="humor-message">
                      <span className="emoji">⛳️</span>
                      <p>No changes on this hole! Looks like a perfect par.</p>
                      <small>Everything is clean in {selectedFile || 'the working tree'}.</small>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="welcome" style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minWidth: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', position: 'relative', overflow: 'hidden', margin: 0, padding: 0 }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0 }}>
              <LiquidGreen />
            </div>
          </div>
        )}
      </main>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal modal-browse">
            <div className="modal-header-row">
              <h3>Add Repository</h3>
              <button className="icon-btn" onClick={() => setShowAddModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="browse-tabs">
              <button
                className={`browse-tab ${browseMode ? 'active' : ''}`}
                onClick={() => { setBrowseMode(true); if (!browsePath) fetchBrowseEntries(); }}
              >
                Browse
              </button>
              <button
                className={`browse-tab ${!browseMode ? 'active' : ''}`}
                onClick={() => setBrowseMode(false)}
              >
                Enter Path
              </button>
            </div>

            {browseMode ? (
              <div className="browse-container">
                <div className="browse-current-path">
                  <span className="browse-path-label">{browsePath}</span>
                  <label className="browse-hidden-toggle">
                    <input
                      type="checkbox"
                      checked={showHidden}
                      onChange={(e) => {
                        setShowHidden(e.target.checked);
                        fetchBrowseEntries(browsePath, e.target.checked);
                      }}
                    />
                    Show hidden
                  </label>
                </div>

                {browseError && <div className="browse-error">{browseError}</div>}

                <div className="browse-list">
                  {browseLoading ? (
                    <div className="browse-loading">Loading...</div>
                  ) : (
                    <>
                      {browseParentPath && (
                        <div
                          className="browse-item browse-parent"
                          onClick={() => fetchBrowseEntries(browseParentPath)}
                        >
                          <ChevronUp size={16} className="browse-item-icon" />
                          <span className="browse-item-name">Parent Directory</span>
                        </div>
                      )}
                      {browseEntries.map((entry) => (
                        <div
                          key={entry.path}
                          className={`browse-item ${entry.isGitRepo ? 'browse-git-repo' : ''} ${newRepoPath === entry.path ? 'browse-selected' : ''}`}
                          onClick={() => setNewRepoPath(entry.path)}
                          onDoubleClick={() => fetchBrowseEntries(entry.path)}
                        >
                          {entry.isGitRepo ? (
                            <FolderGit2 size={16} className="browse-item-icon browse-icon-git" />
                          ) : (
                            <Folder size={16} className="browse-item-icon" />
                          )}
                          <span className="browse-item-name">{entry.name}</span>
                          {entry.isGitRepo && (
                            <span className="browse-git-badge">
                              <GitBranch size={12} /> Git
                            </span>
                          )}
                        </div>
                      ))}
                      {browseEntries.length === 0 && !browseLoading && (
                        <div className="browse-empty">No subdirectories found</div>
                      )}
                    </>
                  )}
                </div>

                <div className="browse-footer">
                  <input
                    type="text"
                    className="browse-selected-path"
                    value={newRepoPath}
                    onChange={(e) => setNewRepoPath(e.target.value)}
                    placeholder="Selected path or type manually..."
                  />
                  <div className="modal-actions">
                    <button type="button" onClick={() => setShowAddModal(false)}>Cancel</button>
                    <button
                      className="primary"
                      disabled={!newRepoPath}
                      onClick={submitAddRepo}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddRepo}>
                <input
                  type="text"
                  placeholder="/absolute/path/to/repo"
                  value={newRepoPath}
                  onChange={(e) => setNewRepoPath(e.target.value)}
                  autoFocus
                />
                <div className="modal-actions">
                  <button type="button" onClick={() => setShowAddModal(false)}>Cancel</button>
                  <button type="submit" className="primary">Add</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Settings</h3>
            <div className="settings-field">
              <label>Active Poll Interval (seconds):</label>
              <input 
                type="number" 
                value={globalInterval}
                onChange={(e) => setGlobalInterval(Number(e.target.value))}
                min="5"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={() => setShowSettingsModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
