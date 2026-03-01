import React, { useEffect, useState } from 'react';
import './GitGraph.css';

export interface LogEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  type: 'commit' | 'stash';
  diff?: { insertions: number; deletions: number; files: number };
}

interface GitGraphProps {
  repoId: string;
  isVisible: boolean;
  onSelectRange: (from: string | null, to: string | null) => void;
}

const GitGraph: React.FC<GitGraphProps> = ({ repoId, isVisible, onSelectRange }) => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });

  useEffect(() => {
    if (isVisible && repoId) {
      setLoading(true);
      fetch(`http://localhost:3001/api/repositories/${repoId}/log`)
        .then(res => res.json())
        .then(data => {
          setEntries(data.items || []);
          setLoading(false);
        })
        .catch(err => {
          console.error('Failed to fetch log', err);
          setLoading(false);
        });
    }
  }, [repoId, isVisible]);

  if (!isVisible) return null;

  // Placeholder for SVG graph
  return (
    <div className="git-graph-panel">
      <div className="git-graph-header">
        <h4>History</h4>
      </div>
      <div className="git-graph-content">
        {loading ? (
          <div className="loading">Loading history...</div>
        ) : (
          <ul className="simple-log-list">
             <li 
                className={`log-item ${selection.from === null ? 'selected-from' : ''}`}
                onClick={() => {
                    const newSel = { from: null, to: null }; // Working Tree
                    setSelection(newSel);
                    onSelectRange(null, null);
                }}
             >
                <div className="log-node node-working"></div>
                <div className="log-info">
                    <span className="log-msg">Working Tree (Current Changes)</span>
                </div>
             </li>
            {entries.map(entry => (
              <li key={entry.hash} className="log-item">
                <div className={`log-node node-${entry.type}`}></div>
                <div className="log-info">
                  <span className="log-msg">{entry.message}</span>
                  <span className="log-meta">
                    {new Date(entry.date).toLocaleDateString()} • {entry.author_name}
                    {entry.type === 'stash' && <span className="stash-badge">STASH</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default GitGraph;
