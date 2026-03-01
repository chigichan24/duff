import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';
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
  const [selection, setSelection] = useState<{ from: string | null | 'UNSET'; to: string | null | 'UNSET' }>({ from: 'UNSET', to: 'UNSET' });
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
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
    const clickedId = hash || 'WORKING_TREE';
    const clickedIndex = graphData.findIndex(n => n.hash === clickedId);
    
    let newSelection = { ...selection };

    if (e.shiftKey && selection.from !== 'UNSET') {
      // Range selection
      newSelection.to = hash;
    } else {
      // Single selection
      newSelection.from = hash;
      newSelection.to = 'UNSET'; // Use a special marker for 'not set' vs 'Working Tree (null)'
    }

    setSelection(newSelection);
    
    // Calculate the actual range for the API
    const fromId = newSelection.from || 'WORKING_TREE';
    const toId = newSelection.to === 'UNSET' ? fromId : (newSelection.to || 'WORKING_TREE');
    
    const idx1 = graphData.findIndex(n => n.hash === fromId);
    const idx2 = graphData.findIndex(n => n.hash === toId);
    
    const olderIdx = Math.max(idx1, idx2);
    const newerIdx = Math.min(idx1, idx2);
    
    const olderNode = graphData[olderIdx];
    const newerNode = graphData[newerIdx];
    
    // To make it inclusive of the olderNode, we use its parent as the base.
    // In our linear log, the parent of graphData[i] is graphData[i+1].
    let baseHash: string | null = null;
    if (olderIdx < graphData.length - 1) {
      baseHash = graphData[olderIdx + 1].hash;
    } else {
      // Root commit case: can't easily get parent, so fallback to the commit itself (exclusive)
      baseHash = olderNode.hash;
    }
    
    // If newerNode is Working Tree, target is null
    const targetHash = newerNode.hash === 'WORKING_TREE' ? null : newerNode.hash;
    
    // Special case: if only one node selected AND it's Working Tree
    if (newSelection.to === 'UNSET' && fromId === 'WORKING_TREE') {
      onSelectRange(null, null); // Default: HEAD vs Working Tree
    } else {
      onSelectRange(baseHash === 'WORKING_TREE' ? null : baseHash, targetHash);
    }
  };

  const copyToClipboard = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
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

                return <React.Fragment key={i}>{lines}</React.Fragment>;
              })}

              {/* Nodes */}
              {graphData.map((node) => {
                const isWorkingTree = node.hash === 'WORKING_TREE';
                const nodeHash = isWorkingTree ? null : node.hash;
                
                const isSelectedFrom = selection.from === nodeHash && selection.from !== 'UNSET';
                const isSelectedTo = selection.to === nodeHash && selection.to !== 'UNSET';
                
                // Special case: Default view (nothing selected or only Working Tree selected explicitly)
                const isDefaultView = selection.from === 'UNSET' || (selection.from === null && selection.to === 'UNSET');
                const isActuallySelectedFrom = isSelectedFrom || (isWorkingTree && isDefaultView);

                let stroke = 'transparent';
                let strokeWidth = 0;
                
                if (isActuallySelectedFrom) {
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
                    <foreignObject 
                        x={node.x + 15} 
                        y={node.y - 12} 
                        width="240" 
                        height="40"
                    >
                        <div className={`graph-node-info ${isActuallySelectedFrom || isSelectedTo ? 'selected' : ''}`}>
                            <div className="node-msg-row">
                                <span className="node-message" title={node.message}>
                                    {node.message.split('\n')[0]}
                                </span>
                                {!isWorkingTree && (
                                    <button 
                                        className="copy-hash-btn" 
                                        onClick={(e) => copyToClipboard(node.hash, e)}
                                        title="Copy Hash"
                                    >
                                        {copiedHash === node.hash ? <Check size={10} /> : <Copy size={10} />}
                                    </button>
                                )}
                            </div>
                            <div className="node-meta-row">
                                {isWorkingTree ? 'Current Changes' : `${node.hash.substring(0, 7)} • ${node.author_name}`}
                            </div>
                        </div>
                    </foreignObject>
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
