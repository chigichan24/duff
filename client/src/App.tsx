import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, RefreshCw, GitBranch, Settings, X, GripVertical } from 'lucide-react';
import * as Diff2Html from 'diff2html';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult, DroppableProps } from '@hello-pangea/dnd';
import 'diff2html/bundles/css/diff2html.min.css';
import './App.css';

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
  const diffHtml = Diff2Html.html(diff, {
    drawFileList: false,
    matching: 'lines',
    outputFormat: 'side-by-side',
    renderNothingWhenEmpty: true,
  });

  return (
    <div 
      className="diff-content"
      dangerouslySetInnerHTML={{ __html: diffHtml }} 
    />
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
  const [activeDiff, setActiveDiff] = useState<string>('');
  const [globalInterval, setGlobalInterval] = useState(30);
  const [sidebarWidth, setSidebarWidth] = useState(300);
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
      fetchDiff(activeRepoId, selectedFile);
    }
  }, [activeRepoId, selectedFile]);

  const startResizing = (e: React.MouseEvent) => {
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

  const fetchDiff = async (id: string, file: string | null) => {
    try {
      const url = `http://localhost:3001/api/repositories/${id}/diff${file ? `?file=${encodeURIComponent(file)}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      setActiveDiff(data.diff);
    } catch (err) {
      console.error('Failed to fetch diff', err);
    }
  };

  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const filteredFiles = activeRepo?.status?.modifiedFiles.filter(f => 
    f.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

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
          <button onClick={() => setShowAddModal(true)} className="icon-btn" title="Add Repository">
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

      <main className="main-content">
        {activeRepo ? (
          <>
            <header className="main-header">
              <div className="header-top">
                <h3>{activeRepo.name} <span className="branch-label">({activeRepo.status?.branch})</span></h3>
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
                  {filteredFiles.map(file => (
                    <li 
                      key={file} 
                      className={selectedFile === file ? 'selected' : ''}
                      onClick={() => setSelectedFile(file)}
                    >
                      {file}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="diff-viewer">
                {activeDiff ? (
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
          <div className="welcome">
            <div className="humor-message">
              <span className="emoji">🏌️‍♂️</span>
              <p>Ready to tee off?</p>
              <small>Select a repository from the bag to start viewing diffs!</small>
            </div>
          </div>
        )}
      </main>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Add Repository</h3>
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
