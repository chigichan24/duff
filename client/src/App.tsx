import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, Plus, Trash2, RefreshCw, GitBranch, Settings, X, GripVertical, Copy, File, History, ShieldAlert, Key, Loader2 } from 'lucide-react';
import * as Diff2Html from 'diff2html';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult, DroppableProps } from '@hello-pangea/dnd';
import pixelmatch from 'pixelmatch';
import 'diff2html/bundles/css/diff2html.min.css';
import './App.css';
import LiquidGreen from './components/LiquidGreen';
import GitGraph from './components/GitGraph';
import { gitService, type RepoStatus } from './lib/gitService';
import { repoStore, type RepositoryMetadata } from './lib/repoStore';

// Custom Droppable
export const StrictModeDroppable = ({ children, ...props }: DroppableProps) => {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const animation = requestAnimationFrame(() => setEnabled(true));
    return () => { cancelAnimationFrame(animation); setEnabled(false); };
  }, []);
  if (!enabled) return null;
  return <Droppable {...props}>{children}</Droppable>;
};

function splitFilePath(filePath: string): { dir: string; name: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return { dir: '', name: filePath };
  return { dir: filePath.substring(0, lastSlash + 1), name: filePath.substring(lastSlash + 1) };
}

const isImageFile = (filename: string | null) => {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
};

const ImageDiffView = ({ handle, file, lastUpdate, range }: { handle: FileSystemDirectoryHandle | null; file: string; lastUpdate?: string; range: { from: string | null; to: string | null } }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [modalImage, setModalImage] = useState<{ url?: string; canvas?: HTMLCanvasElement; title: string } | null>(null);

  useEffect(() => {
    if (!handle) return;
    let bUrl: string | null = null, aUrl: string | null = null;
    const loadImages = async () => {
      const bData = await gitService.getFileContent(handle, file, range.from || 'HEAD');
      const aData = await gitService.getFileContent(handle, file, range.to || undefined);
      if (bData) { bUrl = URL.createObjectURL(new Blob([bData])); setBeforeUrl(bUrl); } else setBeforeUrl(null);
      if (aData) { aUrl = URL.createObjectURL(new Blob([aData])); setAfterUrl(aUrl); } else setAfterUrl(null);
    };
    loadImages();
    return () => { if (bUrl) URL.revokeObjectURL(bUrl); if (aUrl) URL.revokeObjectURL(aUrl); };
  }, [handle, file, lastUpdate, range]);

  useEffect(() => {
    const loadImage = (url: string): Promise<HTMLImageElement | null> => new Promise((resolve) => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img); img.onerror = () => resolve(null);
        img.src = url;
    });
    const runDiff = async () => {
      if (!beforeUrl || !afterUrl || !canvasRef.current) return;
      try {
        const [img1, img2] = await Promise.all([loadImage(beforeUrl), loadImage(afterUrl)]);
        if (!img1 || !img2 || img1.width !== img2.width || img1.height !== img2.height) { setError('Mismatch'); return; }
        const canvas = canvasRef.current;
        canvas.width = img1.width; canvas.height = img1.height;
        const ctx = canvas.getContext('2d')!;
        const c1 = document.createElement('canvas'), c2 = document.createElement('canvas');
        c1.width = c2.width = img1.width; c1.height = c2.height = img1.height;
        const ctx1 = c1.getContext('2d')!, ctx2 = c2.getContext('2d')!;
        ctx1.drawImage(img1, 0, 0); ctx2.drawImage(img2, 0, 0);
        const diffData = ctx.createImageData(img1.width, img1.height);
        pixelmatch(ctx1.getImageData(0, 0, img1.width, img1.height).data, ctx2.getImageData(0, 0, img1.width, img1.height).data, diffData.data, img1.width, img1.height, { threshold: 0.1 });
        ctx.putImageData(diffData, 0, 0); setError(null);
      } catch (err: any) { setError('Visual diff failed'); }
    };
    runDiff();
  }, [beforeUrl, afterUrl]);

  return (
    <div className="image-diff-container">
      <div className="image-diff-grid">
        <div className="image-diff-item"><h5>Before ({range.from || 'HEAD'})</h5><div className="image-wrapper">{beforeUrl ? <img src={beforeUrl} alt="Before" onClick={() => setModalImage({ url: beforeUrl, title: 'Before' })} /> : <div className="no-image-placeholder">N/A</div>}</div></div>
        <div className="image-diff-item"><h5>After ({range.to || 'Working'})</h5><div className="image-wrapper">{afterUrl ? <img src={afterUrl} alt="After" onClick={() => setModalImage({ url: afterUrl, title: 'After' })} /> : <div className="no-image-placeholder">N/A</div>}</div></div>
        <div className="image-diff-item"><h5>Visual Diff</h5><div className="image-wrapper">{beforeUrl && afterUrl ? <canvas ref={canvasRef} onClick={() => { const newCanvas = document.createElement('canvas'); newCanvas.width = canvasRef.current!.width; newCanvas.height = canvasRef.current!.height; newCanvas.getContext('2d')!.drawImage(canvasRef.current!, 0, 0); setModalImage({ canvas: newCanvas, title: 'Visual Diff' }); }} /> : <div className="no-image-placeholder">N/A</div>}</div></div>
      </div>
      {error && <div className="diff-error">{error}</div>}
      {modalImage && <div className="image-modal-overlay" onClick={() => setModalImage(null)}><div className="image-modal-content" onClick={e => e.stopPropagation()}><span className="image-modal-title">{modalImage.title}</span>{modalImage.url ? <img src={modalImage.url} alt={modalImage.title} /> : modalImage.canvas ? <div ref={el => { if (el && modalImage.canvas && !el.hasChildNodes()) el.appendChild(modalImage.canvas); }} /> : null}<button className="close-modal" onClick={() => setModalImage(null)}><X size={32} /></button></div></div>}
    </div>
  );
};

const DiffView = ({ diff }: { diff: string }) => {
  const files = useMemo(() => Diff2Html.parse(diff), [diff]);
  if (files.length === 0) return <div className="no-diff"><div className="humor-message"><span className="emoji">⛳️</span><p>No changes detected.</p></div></div>;
  return (
    <div className="diff-files-container">
      {files.map((file, idx) => {
        const html = Diff2Html.html([file], { drawFileList: false, matching: 'lines', outputFormat: 'side-by-side', renderNothingWhenEmpty: true });
        const fileName = file.newName === '/dev/null' ? file.oldName : file.newName;
        return (
          <div key={idx} className="diff-file-section">
            <header className="liquid-glass-header">
              <div className="liquid-glass-bg"></div>
              <div className="header-content">
                <File size={16} className="file-icon" />
                <span className="file-name">{fileName}</span>
                <button className="copy-filename-btn" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(fileName); }}><Copy size={12} /></button>
              </div>
            </header>
            <div className="diff-content" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        );
      })}
    </div>
  );
};

interface Repository extends RepositoryMetadata {
  handle?: FileSystemDirectoryHandle;
  hasPermission?: boolean;
  status?: RepoStatus;
}

function App() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeDiff, setActiveDiff] = useState('');
  const [modifiedFiles, setModifiedFiles] = useState<Record<string, string[]>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [diffRange, setDiffRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const isResizing = useRef(false);

  const activeRepo = useMemo(() => repos.find(r => r.id === activeId), [repos, activeId]);
  const activeHandle = useMemo(() => activeRepo?.handle, [activeRepo]);
  const activeStatus = useMemo(() => activeRepo?.status, [activeRepo]);
  const activeFiles = useMemo(() => (activeId ? modifiedFiles[activeId] || [] : []).filter(f => f.toLowerCase().includes(searchTerm.toLowerCase())), [activeId, modifiedFiles, searchTerm]);

  const updateStatus = useCallback(async (id: string, handle: FileSystemDirectoryHandle) => {
    setIsUpdating(true);
    try {
      const status = await gitService.getStatus(handle);
      setRepos(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      setModifiedFiles(prev => ({ ...prev, [id]: status.modifiedFiles }));
    } catch (err) { console.error(err); } finally { setIsUpdating(false); }
  }, []);

  useEffect(() => {
    (async () => {
      const metas = await repoStore.getRepositories();
      const list: Repository[] = [];
      for (const m of metas) {
        const h = await repoStore.getHandle(m.id);
        const r: Repository = { ...m, handle: h, hasPermission: false };
        if (h && (await (h as any).queryPermission({ mode: 'readwrite' })) === 'granted') r.hasPermission = true;
        list.push(r);
      }
      setRepos(list); setIsLoading(false);
      if (list[0]?.hasPermission && list[0].handle) updateStatus(list[0].id, list[0].handle);
    })();
  }, [updateStatus]);

  useEffect(() => {
    if (activeHandle && activeRepo?.hasPermission) {
        gitService.getDiff(activeHandle, selectedFile || undefined, diffRange.from || undefined, diffRange.to || undefined)
            .then(setActiveDiff).catch(() => setActiveDiff(''));
    } else setActiveDiff('');
  }, [activeHandle, selectedFile, activeRepo?.hasPermission, activeStatus?.lastUpdate, diffRange]);

  const handleGrant = async (repo: Repository) => {
    if (!repo.handle) return;
    const ok = await repoStore.verifyPermission(repo.handle);
    if (ok) {
      setRepos(prev => prev.map(r => r.id === repo.id ? { ...r, hasPermission: true } : r));
      updateStatus(repo.id, repo.handle);
    }
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const items = Array.from(repos);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setRepos(items);
    await repoStore.saveRepositories(items.map(({id, name, addedAt}) => ({id, name, addedAt})));
  };

  return (
    <div className="app-container">
      <aside className="sidebar" style={{ width: `${sidebarWidth}px`, flex: 'none' }}>
        <div className="sidebar-header">
          <h2 className="logo" onClick={() => { setActiveId(null); setSelectedFile(null); }}>⛳️ Duff</h2>
          <button onClick={() => setShowAddModal(true)} className="icon-btn"><Plus size={20} /></button>
        </div>
        <DragDropContext onDragEnd={onDragEnd}>
          <StrictModeDroppable droppableId="repos">
            {(provided) => (
              <div className="repo-list" {...provided.droppableProps} ref={provided.innerRef}>
                {isLoading ? <div style={{padding:'20px'}}>Loading...</div> : repos.map((repo, idx) => (
                  <Draggable key={repo.id} draggableId={repo.id} index={idx}>
                    {(p, snap) => (
                      <div ref={p.innerRef} {...p.draggableProps} className={`repo-item ${activeId === repo.id ? 'active' : ''} ${snap.isDragging ? 'dragging' : ''} ${!repo.hasPermission ? 'permission-needed' : ''}`}
                           onClick={() => { setActiveId(repo.id); setSelectedFile(null); setDiffRange({from:null,to:null}); if(!repo.hasPermission && repo.handle) handleGrant(repo); }}>
                        <div className="repo-main-content">
                          <div className="drag-handle" {...p.dragHandleProps}><GripVertical size={16} /></div>
                          <div className="repo-info-container">
                            <div className="repo-info"><span className="repo-name">{repo.name}</span><div className="repo-actions">{repo.status?.hasChanges && <span className="change-badge"></span>}<button onClick={async (e) => { e.stopPropagation(); if(confirm('Remove?')){ await repoStore.removeRepository(repo.id); setRepos(prev => prev.filter(r => r.id !== repo.id)); if(activeId === repo.id) setActiveId(null); } }} className="delete-btn icon-btn"><Trash2 size={14} /></button></div></div>
                            <div className="repo-details">{!repo.hasPermission ? <span className="permission-msg"><Key size={10} /> Access Required</span> : <span className="repo-branch"><GitBranch size={12} /> {repo.status?.branch || '...'}</span>}</div>
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
        <div className="sidebar-footer"><Settings size={20} /><span>Config</span></div>
      </aside>

      <div className="resizer" onMouseDown={e => { isResizing.current = true; const move = (me: MouseEvent) => { if (!isResizing.current) return; setSidebarWidth(Math.max(200, Math.min(600, me.clientX))); }; const up = () => { isResizing.current = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); }} />

      <main className="main-content">
        {activeRepo ? (
          <>
            <header className="main-header">
              <div className="header-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => setShowHistory(!showHistory)} className={`icon-btn ${showHistory ? 'active' : ''}`}><History size={18} /></button>
                  <h3>{activeRepo.name} <span className="branch-label">({activeRepo.status?.branch || '...'})</span></h3>
                </div>
                <div className="header-meta">
                  <span>Last updated: {activeStatus?.lastUpdate ? new Date(activeStatus.lastUpdate).toLocaleTimeString() : '...'}</span>
                  <button onClick={() => activeHandle && updateStatus(activeId!, activeHandle)} className="icon-btn"><RefreshCw size={16} className={isUpdating ? 'animate-spin' : ''} /></button>
                </div>
              </div>
              <div className="search-bar"><Search size={18} /><input type="text" placeholder="Filter files..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
            </header>
            <div className="content-body">
              {!activeRepo.hasPermission ? (
                 <div className="permission-required-view"><ShieldAlert size={48} /><h3>Permission Required</h3><button className="primary" onClick={() => handleGrant(activeRepo)}>Grant Access</button></div>
              ) : (
                <>
                  <div className="file-list">
                    <h4>Modified Files ({activeFiles.length})</h4>
                    <ul>
                      <li className={selectedFile === null ? 'selected' : ''} onClick={() => setSelectedFile(null)}>All Changes</li>
                      {activeFiles.map(f => {
                        const { dir, name } = splitFilePath(f);
                        return (
                          <li key={f} className={selectedFile === f ? 'selected' : ''} onClick={() => setSelectedFile(f)}>
                            <span className="file-path-text">{dir && <span className="file-dir">{dir}</span>}<span>{name}</span></span>
                            <button className="copy-filename-btn" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(name); }}><Copy size={12} /></button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="diff-viewer">
                    {showHistory ? (
                      <GitGraph repoId={activeId!} handle={activeHandle || null} isVisible={true} onSelectRange={(from, to) => { setDiffRange({ from, to }); setSelectedFile(null); }} />
                    ) : (
                      selectedFile && isImageFile(selectedFile) ? (
                        <ImageDiffView handle={activeHandle || null} file={selectedFile} lastUpdate={activeStatus?.lastUpdate} range={diffRange} />
                      ) : (
                        <DiffView diff={activeDiff} />
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="welcome">
            <div style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none' }}><LiquidGreen /></div>
            <div className="welcome-content" style={{ zIndex: 1, textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.8)', padding: '40px', borderRadius: '16px', backdropFilter: 'blur(10px)' }}>
               <h1>🏌️‍♂️ Welcome to Duff</h1><p>Visualize your progress across multiple Git repositories.</p>
               <button className="primary" onClick={() => setShowAddModal(true)} style={{ marginTop: '1rem' }}><Plus size={18} style={{ marginRight: '8px' }} />Add your first repository</button>
            </div>
          </div>
        )}
      </main>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Add Repository</h3>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="primary" onClick={async () => {
                try {
                  const h = await (window as any).showDirectoryPicker();
                  const m = await repoStore.addRepository(h);
                  setRepos(prev => [...prev, { ...m, handle: h, hasPermission: true }]);
                  setShowAddModal(false);
                  updateStatus(m.id, h);
                } catch (e) {}
              }}>Select Folder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
