import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, RefreshCw, GitBranch, Settings, X } from 'lucide-react';
import * as Diff2Html from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';
import './App.css';

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

  const fetchRepos = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/repositories');
      const data = await res.json();
      setRepositories(data);
      // Also update statuses
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
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Duff</h2>
          <button onClick={() => setShowAddModal(true)} className="icon-btn" title="Add Repository">
            <Plus size={20} />
          </button>
        </div>
        
        <div className="repo-list">
          {repositories.map(repo => (
            <div 
              key={repo.id} 
              className={`repo-item ${activeRepoId === repo.id ? 'active' : ''}`}
              onClick={() => {
                setActiveRepoId(repo.id);
                setSelectedFile(null);
              }}
            >
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
          ))}
        </div>

        <div className="sidebar-footer" onClick={() => setShowSettingsModal(true)}>
          <Settings size={20} />
          <span>Config</span>
        </div>
      </aside>

      {/* Main Content */}
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
                  <div className="no-diff">No changes detected in {selectedFile || 'the working tree'}</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="welcome">
            <p>Select a repository to view diffs</p>
          </div>
        )}
      </main>

      {/* Add Modal */}
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

      {/* Settings Modal */}
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
