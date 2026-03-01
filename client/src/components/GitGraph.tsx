import React, { useEffect, useState, useRef, useMemo } from 'react';
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

interface GraphNode extends LogEntry {
  x: number;
  y: number;
  r: number;
  color: string;
}

const CONFIG = {
  spacing: 36,
  xMain: 40,
  xStash: 80,
  baseRadius: 5,
  maxRadius: 10,
  strokeWidth: 2,
  colors: {
    commit: '#3b82f6',
    stash: '#f59e0b',
    working: '#10b981',
    selectedFrom: '#00c853',
    selectedTo: '#ef4444',
    line: '#e5e7eb',
    lineStash: '#fbbf24' // lighter amber
  }
};

const GitGraph: React.FC<GitGraphProps> = ({ repoId, isVisible, onSelectRange }) => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const svgRef = useRef<SVGSVGElement>(null);

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

  const handleNodeClick = (hash: string | null, e: React.MouseEvent) => {
    let newSelection = { ...selection };

    if (e.shiftKey) {
      // Range selection (To)
      if (newSelection.from === hash) {
        // Deselect if clicking same
        newSelection.from = null; 
      } else {
        newSelection.to = hash;
      }
    } else {
      // Base selection (From)
      // If clicking same, clear selection (back to HEAD vs Working Tree)
      if (newSelection.from === hash && newSelection.to === null) {
        newSelection.from = null;
      } else {
        newSelection.from = hash;
        newSelection.to = null; // Reset To when changing From without shift
      }
    }

    setSelection(newSelection);
    onSelectRange(newSelection.from, newSelection.to);
  };

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    
    // Working Tree Node (Pseudo)
    nodes.push({
      hash: 'WORKING_TREE', // Special ID
      date: new Date().toISOString(),
      message: 'Working Tree',
      author_name: 'You',
      type: 'commit', // Treat as commit for rendering but color differently
      x: CONFIG.xMain,
      y: CONFIG.spacing,
      r: CONFIG.baseRadius,
      color: CONFIG.colors.working
    });

    entries.forEach((entry, i) => {
      const isStash = entry.type === 'stash';
      const changes = entry.diff ? entry.diff.insertions + entry.diff.deletions : 0;
      // Logarithmic scaling for radius
      const radius = Math.min(CONFIG.maxRadius, CONFIG.baseRadius + Math.log(changes + 1));
      
      nodes.push({
        ...entry,
        x: isStash ? CONFIG.xStash : CONFIG.xMain,
        y: (i + 2) * CONFIG.spacing, // +2 because of Working Tree node and 0-based index
        r: radius,
        color: isStash ? CONFIG.colors.stash : CONFIG.colors.commit
      });
    });

    return nodes;
  }, [entries]);

  if (!isVisible) return null;

  const height = (entries.length + 2) * CONFIG.spacing + 20;

  return (
    <div className="git-graph-panel">
      <div className="git-graph-header">
        <h4>History</h4>
        <div className="graph-legend">
          <span className="legend-item"><span className="dot commit"></span> Commit</span>
          <span className="legend-item"><span className="dot stash"></span> Stash</span>
        </div>
      </div>
      <div className="git-graph-content">
        {loading ? (
          <div className="loading">Loading history...</div>
        ) : (
          <div className="svg-container">
            <svg 
              ref={svgRef} 
              width="100%" 
              height={height}
              style={{ minHeight: '100%' }}
            >
              {/* Lines */}
              {graphData.map((node, i) => {
                if (i === graphData.length - 1) return null;
                const nextNode = graphData[i + 1];
                
                // Simple line logic: connect current to next in time
                // Ideally we use parent hashes, but for "single log" view, sequential connection is okay visual proxy
                // except for Stashes which should connect to their parent (not available easily).
                // So we'll draw a main line down the commit axis, and connect stashes to it.
                
                const isNextStash = nextNode.type === 'stash';
                const isCurrentStash = node.type === 'stash';

                // Main vertical line for commits
                if (!isCurrentStash && !isNextStash) {
                   return (
                     <line 
                       key={`line-${i}`}
                       x1={node.x} y1={node.y}
                       x2={nextNode.x} y2={nextNode.y}
                       stroke={CONFIG.colors.line}
                       strokeWidth={CONFIG.strokeWidth}
                     />
                   );
                }
                
                // If next is stash, we still want to continue the main line to the next COMMIT (skipping stashes)
                // Find next commit
                let nextCommitIndex = i + 1;
                while(nextCommitIndex < graphData.length && graphData[nextCommitIndex].type === 'stash') {
                  nextCommitIndex++;
                }
                const nextCommit = graphData[nextCommitIndex];

                const lines = [];
                
                if (!isCurrentStash && nextCommit) {
                   lines.push(
                     <line 
                       key={`line-main-${i}`}
                       x1={node.x} y1={node.y}
                       x2={nextCommit.x} y2={nextCommit.y}
                       stroke={CONFIG.colors.line}
                       strokeWidth={CONFIG.strokeWidth}
                     />
                   );
                }

                // Connect Stash to main line (approximate, to the previous commit or parallel)
                // For now, just a small horizontal link to main axis if it's a stash
                if (isCurrentStash) {
                   lines.push(
                     <path
                       key={`line-stash-${i}`}
                       d={`M${node.x},${node.y} L${CONFIG.xMain},${node.y + CONFIG.spacing/2}`} 
                       stroke={CONFIG.colors.lineStash}
                       strokeWidth={1}
                       strokeDasharray="4 2"
                       fill="none"
                     />
                   );
                }

                return <>{lines}</>;
              })}

              {/* Nodes */}
              {graphData.map((node) => {
                const isWorkingTree = node.hash === 'WORKING_TREE';
                const isSelectedFrom = selection.from === node.hash || (isWorkingTree && selection.from === null && selection.to === null);
                // logic for "Working Tree" selection is tricky. 
                // Default: from=null, to=null -> Working Tree vs HEAD (diff view defaults to this).
                // But in graph, Working Tree node represents the "dirty state".
                // If I click a commit, that becomes 'from'. 'to' becomes null (Working Tree).
                // If I click Working Tree node, it should probably clear selection (reset to default).
                
                // Update: selection logic in handleNodeClick
                // hash=null passed for Working Tree
                
                const isSelectedTo = selection.to === node.hash;
                
                let stroke = 'transparent';
                let strokeWidth = 0;
                
                if (isSelectedFrom) {
                  stroke = CONFIG.colors.selectedFrom;
                  strokeWidth = 3;
                } else if (isSelectedTo) {
                  stroke = CONFIG.colors.selectedTo;
                  strokeWidth = 3;
                }

                return (
                  <g 
                    key={node.hash} 
                    onClick={(e) => handleNodeClick(isWorkingTree ? null : node.hash, e)}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.r}
                      fill={isWorkingTree ? CONFIG.colors.working : node.color}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                    />
                    <text 
                      x={node.x + 20} 
                      y={node.y + 4} 
                      className="graph-label"
                      style={{ 
                        fontSize: '12px', 
                        fill: isSelectedFrom || isSelectedTo ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: isSelectedFrom || isSelectedTo ? 600 : 400
                      }}
                    >
                      {node.message}
                    </text>
                    <text 
                      x={node.x + 20} 
                      y={node.y + 18} 
                      className="graph-meta"
                      style={{ fontSize: '10px', fill: 'var(--text-tertiary)' }}
                    >
                       {isWorkingTree ? 'Current Changes' : `${node.hash.substring(0, 7)} • ${node.author_name}`}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

export default GitGraph;
