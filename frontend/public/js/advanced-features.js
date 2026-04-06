// ===== ADVANCED FEATURES FOR 8 NEXT-GEN OSINT CAPABILITIES =====
// This module provides implementations for:
// 1. Real-Time Threat Correlation Dashboard
// 2. AI-Powered OSINT Agent
// 3. Collaborative Intelligence Workspace
// 4. Advanced Export & Reporting
// 5. Entity Relationship Graph Visualization
// 6. Automated Monitoring System
// 7. Integrated Exploit Simulation
// 8. Privacy-Preserving Aggregator

// ===== FEATURE 1: THREAT CORRELATION DASHBOARD =====
async function startThreatCorrelation() {
    const entity = document.getElementById('correlation-entity')?.value?.trim();
    if (!entity) {
        alert('Enter an entity (domain, IP, CVE, etc.)');
        return;
    }

    const resultsDiv = document.getElementById('correlation-results');
    const graphDiv = document.getElementById('correlation-graph');
    
    resultsDiv.innerHTML = '<span class="terminal-spinner"></span> Analyzing threat correlations...';
    graphDiv.innerHTML = '';

    try {
        const response = await apiRequest('/api/correlation/analyze', {
            method: 'POST',
            body: JSON.stringify({ entity, token: sessionToken })
        });

        if (response.ok) {
            const data = await response.json();
            resultsDiv.innerHTML = `
                <div style="color: #00ff00; margin-bottom: 1rem;">
                    <strong>Entity:</strong> ${data.entity}<br>
                    <strong>Risk Score:</strong> ${data.riskScore}/10 
                    <span style="color: ${data.riskScore > 7 ? '#ff0000' : '#ffaa00'};">█</span>
                </div>
                <div style="color: #00ffff;">
                    <strong>Correlations:</strong><br>
                    ${data.correlations.map(c => `
                        <div style="margin: 0.3rem 0; padding-left: 1rem;">
                            ${c.type.toUpperCase()}: <strong>${c.value}</strong> 
                            [${c.severity.toUpperCase()}]
                        </div>
                    `).join('')}
                </div>
            `;
            
            graphDiv.innerHTML = `
                <div style="padding: 1rem; color: #00ffff; font-size: 0.9rem;">
                    <strong>Graph Visualization (SVG/D3):</strong><br>
                    [Threat correlation graph would render here with D3.js]<br><br>
                    ${data.correlations.map((c, i) => {
                        if (i > 0) {
                            const prev = data.correlations[i-1];
                            return `→ ${prev.type} → ${c.type}`;
                        }
                        return '';
                    }).filter(Boolean).join(' ')}<br>
                    <br><strong>Analysis:</strong> ${data.correlations.length} entities interconnected
                </div>
            `;
        } else {
            const error = await response.json();
            resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.error}</span>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.message}</span>`;
    }
}

// ===== FEATURE 2: AI OSINT AGENT =====
function setAiAgentStatus(message, tone = 'info') {
    const statusNode = document.getElementById('ai-agent-status');
    if (!statusNode) return;

    statusNode.textContent = `Status: ${message}`;
    if (tone === 'error') {
        statusNode.style.color = '#ff8a8a';
        statusNode.style.borderColor = 'rgba(255, 96, 96, 0.45)';
    } else if (tone === 'success') {
        statusNode.style.color = '#9ce8ff';
        statusNode.style.borderColor = 'rgba(82, 195, 255, 0.5)';
    } else {
        statusNode.style.color = '#72bfff';
        statusNode.style.borderColor = 'rgba(82, 195, 255, 0.28)';
    }
}

async function interpretOsintQuery() {
    const query = document.getElementById('ai-query-input')?.value?.trim();
    const suggestionsDiv = document.getElementById('ai-suggestions');
    if (!query) {
        if (suggestionsDiv) {
            suggestionsDiv.classList.add('active');
            suggestionsDiv.innerHTML = '<span style="color: #ff8a8a;">Enter your recon objective in natural language.</span>';
        }
        setAiAgentStatus('Query input required', 'error');
        return;
    }

    if (!suggestionsDiv) {
        return;
    }

    suggestionsDiv.classList.add('active');
    suggestionsDiv.innerHTML = '<span class="terminal-spinner"></span> Interpreting query...';
    setAiAgentStatus('Interpreting query...', 'info');

    try {
        const data = await apiRequest('/ai/interpret-query', {
            method: 'POST',
            body: JSON.stringify({ query, token: sessionToken })
        });

        suggestionsDiv.innerHTML = `
            <div style="color: #00ffff; margin-bottom: 1rem;">
                <strong>Query Intent:</strong> ${data.interpretedIntent.replace('_', ' ').toUpperCase()}<br>
                <strong>Recommended Workflow:</strong><br>
            </div>
            <div style="color: #00ff00;">
                ${data.suggestedTools.map((tool, i) => `
                    <div style="margin: 0.5rem 0; padding-left: 1rem;">
                        <strong>${i + 1}. ${tool.tool}</strong><br>
                        <span style="color: #00ffff; font-size: 0.9rem;">↳ ${tool.reason}</span>
                    </div>
                `).join('')}
            </div>
        `;
        setAiAgentStatus('Query interpreted successfully', 'success');
    } catch (error) {
        suggestionsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.message}</span>`;
        setAiAgentStatus('Query failed', 'error');
    }
}

async function loadPlaybook() {
    const playbookId = document.getElementById('playbook-select')?.value;
    const resultsDiv = document.getElementById('playbook-results');
    if (!playbookId) {
        if (resultsDiv) {
            resultsDiv.classList.add('active');
            resultsDiv.innerHTML = '<span style="color: #ff8a8a;">Select a playbook before loading.</span>';
        }
        setAiAgentStatus('Playbook selection required', 'error');
        return;
    }

    if (!resultsDiv) {
        return;
    }

    resultsDiv.classList.add('active');
    resultsDiv.innerHTML = '<span class="terminal-spinner"></span> Loading playbook...';
    setAiAgentStatus('Loading playbook...', 'info');

    try {
        const data = await apiRequest('/ai/load-playbook', {
            method: 'POST',
            body: JSON.stringify({ playbookId, token: sessionToken })
        });

        resultsDiv.innerHTML = `
            <div style="color: #00ffff;">
                <strong>Playbook: ${data.playbook.name}</strong><br>
                <strong>Execution Steps:</strong>
            </div>
            <div style="color: #00ff00; margin-top: 0.5rem;">
                ${data.playbook.steps.map((step, i) => `
                    <div style="margin: 0.3rem 0; padding-left: 1rem;">
                        <strong>${i + 1}.</strong> ${step}
                    </div>
                `).join('')}
            </div>
        `;
        setAiAgentStatus('Playbook loaded successfully', 'success');
    } catch (error) {
        resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.message}</span>`;
        setAiAgentStatus('Playbook load failed', 'error');
    }
}

// ===== FEATURE 3: COLLABORATIVE WORKSPACE =====
async function createNewDossier() {
    const dossierName = prompt('Enter dossier name:');
    if (!dossierName) return;

    try {
        await apiRequest('/dossier/create', {
            method: 'POST',
            body: JSON.stringify({ dossierName, content: '', token: sessionToken })
        });

        alert('Dossier created successfully!');
        loadDossierList();
        loadCollaborationLog();
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

async function loadDossierList() {
    const listDiv = document.getElementById('dossier-list');
    if (!listDiv) return;
    listDiv.innerHTML = '<span class="terminal-spinner"></span> Loading dossiers...';
    listDiv.classList.add('active');

    try {
        const data = await apiRequest('/dossier/list', {
            headers: { 'X-Session-Token': sessionToken || '' }
        });

        const dossiers = Array.isArray(data.dossiers) ? data.dossiers : [];
        if (!dossiers.length) {
            listDiv.innerHTML = '<span style="color: #ffaa00;">No dossiers found</span>';
            return;
        }

        listDiv.innerHTML = dossiers.map(d => `
            <div class="dashboard-card" style="cursor: pointer; background: rgba(0,255,255,0.05); border-color: #00ffff;">
                <div class="dashboard-label">${d.dossier_name}</div>
                <div class="dashboard-value" style="font-size: 0.85rem; color: #00ffff;">
                    By: ${d.creator_username}<br>
                    <span style="font-size: 0.75rem; color: #00aaff;">Modified: ${new Date(d.last_modified).toLocaleDateString()}</span>
                </div>
            </div>
        `).join('');
    } catch (error) {
        listDiv.innerHTML = `<span style="color: #ff0000;">Error loading dossiers: ${error.message}</span>`;
    }
}

async function loadCollaborationLog() {
    const logDiv = document.getElementById('collab-log');
    if (!logDiv) return;

    logDiv.classList.add('active');
    logDiv.innerHTML = '<span class="terminal-spinner"></span> Loading collaboration log...';

    try {
        const data = await apiRequest('/activity?limit=40', {
            headers: { 'X-Session-Token': sessionToken || '' }
        });

        const logs = Array.isArray(data.logs) ? data.logs : [];
        if (!logs.length) {
            logDiv.innerHTML = '<span style="color: #ffaa00;">No collaboration activity yet.</span>';
            return;
        }

        logDiv.innerHTML = logs.map(item => `
            <div style="margin: 0.35rem 0; padding: 0.45rem 0.55rem; border-left: 2px solid rgba(82, 195, 255, 0.45); background: rgba(3, 8, 16, 0.65);">
                <div style="color: #9ce8ff; font-size: 0.82rem;">
                    <strong>${item.username}</strong> · ${item.action}${item.tool ? ` · ${item.tool}` : ''}
                </div>
                <div style="color: #72bfff; font-size: 0.76rem; margin-top: 0.2rem;">${item.details || 'No details'}</div>
                <div style="color: #4f7ea8; font-size: 0.72rem; margin-top: 0.2rem;">${new Date(item.timestamp).toLocaleString()}</div>
            </div>
        `).join('');
    } catch (error) {
        logDiv.innerHTML = `<span style="color: #ff8a8a;">Failed to load collaboration log: ${error.message}</span>`;
    }
}

// ===== FEATURE 4: EXPORT & REPORTING =====
async function generateReport() {
    const reportTitle = document.getElementById('report-title')?.value?.trim() || 'Untitled Report';
    const resultsDiv = document.getElementById('report-results');
    resultsDiv.innerHTML = '<span class="terminal-spinner"></span> Generating report...';

    try {
        const response = await apiRequest('/api/report/generate', {
            method: 'POST',
            body: JSON.stringify({ reportTitle, token: sessionToken })
        });

        if (response.ok) {
            const data = await response.json();
            resultsDiv.innerHTML = `
                <div style="color: #00ffff;">
                    <strong>Report Generated: ${data.report.title}</strong><br>
                    <strong>Timestamp:</strong> ${new Date(data.report.generatedAt).toLocaleString()}<br>
                    <strong>Sections:</strong>
                </div>
                <div style="color: #00ff00; margin-top: 0.5rem;">
                    ${data.report.sections.map(s => `
                        <div style="margin: 0.3rem 0; padding-left: 1rem;">
                            ✓ ${s.title}
                        </div>
                    `).join('')}
                </div>
                <div style="color: #ffaa00; margin-top: 0.5rem;">
                    <strong>MITRE Mappings:</strong> ${data.report.mitreMappings.join(', ')}
                </div>
            `;
        } else {
            const error = await response.json();
            resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.error}</span>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.message}</span>`;
    }
}

async function exportReportFormat(format) {
    const resultsDiv = document.getElementById('report-results');
    if (format === 'pdf' && window.html2pdf) {
        resultsDiv.innerHTML += `<div id="export-msg" style="color: #00ff00; margin-top: 1rem;"><span class="terminal-spinner"></span> Rendering GUI to PDF...</div>`;
        const opt = {
            margin:       1,
            filename:     'matrix_osint_dossier.pdf',
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
        };
        try {
            await html2pdf().set(opt).from(resultsDiv).save();
            document.getElementById('export-msg').innerHTML = '✓ Dossier successfully rasterized to local filesystem.';
        } catch(e) {
            document.getElementById('export-msg').innerHTML = `<span style="color:red;">Export Error: ${e.message}</span>`;
        }
        return;
    }

    resultsDiv.innerHTML = `<span class="terminal-spinner"></span> Exporting as ${format.toUpperCase()}...`;

    try {
        const response = await apiRequest('/api/report/export', {
            method: 'POST',
            body: JSON.stringify({ format, token: sessionToken })
        });

        if (response.ok) {
            resultsDiv.innerHTML = `<span style="color: #00ff00;">✓ Report exported as ${format.toUpperCase()}</span>`;
        } else {
            const error = await response.json();
            resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.error}</span>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.message}</span>`;
    }
}

// ===== FEATURE 5: ENTITY RELATIONSHIP GRAPH =====
async function buildEntityGraph() {
    const entity = document.getElementById('graph-entity')?.value?.trim();
    const depth = document.getElementById('graph-depth')?.value || '2';

    if (!entity) {
        alert('Enter an entity name');
        return;
    }

    const canvasDiv = document.getElementById('graph-canvas');
    canvasDiv.innerHTML = '<span class="terminal-spinner"></span> Building entity relationship graph...';

    try {
        const response = await apiRequest('/api/graph/build', {
            method: 'POST',
            body: JSON.stringify({ entity, depth: Number(depth), token: sessionToken })
        });

        if (response.ok) {
            const data = await response.json();
            canvasDiv.innerHTML = ''; 

            if (!window.d3) {
                canvasDiv.innerHTML = '<span style="color: red;">D3.js failed to load. Cannot render graph.</span>';
                return;
            }

            const width = canvasDiv.clientWidth || 800;
            const height = 400;

            const nodesMap = {};
            data.graph.nodes.forEach(n => nodesMap[n.label] = { id: n.label, group: n.type === 'IP' ? 1 : n.type === 'Domain' ? 2 : 3, orig: n });
            
            const edges = data.graph.edges.map(e => ({
                source: nodesMap[e.source] || { id: e.source, group: 0 },
                target: nodesMap[e.target] || { id: e.target, group: 0 },
                value: 1
            }));

            const nodes = Object.values(nodesMap);

            const svg = d3.select(canvasDiv).append('svg')
                .attr('width', width).attr('height', height)
                .style('background', 'rgba(0,0,0,0.4)')
                .style('border', '1px solid var(--matrix-green)');

            const simulation = d3.forceSimulation(nodes)
                .force('link', d3.forceLink(edges).id(d => d.id).distance(120))
                .force('charge', d3.forceManyBody().strength(-400))
                .force('center', d3.forceCenter(width / 2, height / 2));

            const link = svg.append('g').selectAll('line')
                .data(edges).join('line')
                .attr('stroke', 'rgba(255, 170, 0, 0.6)')
                .attr('stroke-width', 2);

            const node = svg.append('g').selectAll('circle')
                .data(nodes).join('circle')
                .attr('r', 8)
                .attr('fill', d => d.group === 1 ? '#00ff00' : d.group === 2 ? '#00aaff' : '#ff0000')
                .call(d3.drag()
                    .on('start', dragstarted)
                    .on('drag', dragged)
                    .on('end', dragended));

            const label = svg.append('g').selectAll('text')
                .data(nodes).join('text')
                .text(d => d.id)
                .attr('fill', '#00ffff')
                .attr('x', 12).attr('y', 4)
                .attr('font-size', '12px');

            simulation.on('tick', () => {
                link
                    .attr('x1', d => d.source.x)
                    .attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x)
                    .attr('y2', d => d.target.y);
                node
                    .attr('cx', d => d.x)
                    .attr('cy', d => d.y);
                label
                    .attr('x', d => d.x + 12)
                    .attr('y', d => d.y + 4);
            });

            function dragstarted(event) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                event.subject.fx = event.subject.x;
                event.subject.fy = event.subject.y;
            }
            function dragged(event) {
                event.subject.fx = event.x;
                event.subject.fy = event.y;
            }
            function dragended(event) {
                if (!event.active) simulation.alphaTarget(0);
                event.subject.fx = null;
                event.subject.fy = null;
            }
        } else {
            const error = await response.json();
            canvasDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.error}</span>`;
        }
    } catch (error) {
        canvasDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.message}</span>`;
    }
}

// ===== FEATURE 6: AUTOMATED MONITORING SYSTEM =====
async function addMonitorTarget() {
    const target = document.getElementById('monitor-target')?.value?.trim();
    const interval = document.getElementById('monitor-interval')?.value || 'daily';

    if (!target) {
        alert('Enter a target to monitor');
        return;
    }

    try {
        const response = await apiRequest('/api/monitor/add-target', {
            method: 'POST',
            body: JSON.stringify({ target, interval, token: sessionToken })
        });

        if (response.ok) {
            alert('Target added to monitoring!');
            document.getElementById('monitor-target').value = '';
            loadMonitorTargets();
        } else {
            const error = await response.json();
            alert(`Error: ${error.error}`);
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

async function loadMonitorTargets() {
    const listDiv = document.getElementById('monitor-list');
    listDiv.innerHTML = '<span class="terminal-spinner"></span> Loading monitors...';

    try {
        const response = await apiRequest('/api/monitor/targets', {
            headers: { 'X-Session-Token': sessionToken || '' }
        });

        if (response.ok) {
            const data = await response.json();
            listDiv.innerHTML = data.targets.length > 0 ? data.targets.map(t => `
                <div style="margin: 0.5rem 0; padding: 0.5rem; border-left: 3px solid #00ffff; color: #00ff00;">
                    <strong>${t.target}</strong><br>
                    <span style="color: #00aaaa; font-size: 0.9rem;">Interval: ${t.interval} | Last Scan: ${new Date(t.last_scanned).toLocaleDateString()}</span>
                </div>
            `).join('') : '<span style="color: #ffaa00;">No targets being monitored</span>';
            
            loadMonitoringAlerts();
        } else {
            listDiv.innerHTML = '<span style="color: #ffaa00;">No targets available</span>';
        }
    } catch (error) {
        listDiv.innerHTML = `<span style="color: #ff0000;">Error loading targets</span>`;
    }
}

async function loadMonitoringAlerts() {
    const alertsDiv = document.getElementById('anomaly-alerts');
    alertsDiv.innerHTML = '<span class="terminal-spinner"></span> Loading alerts...';

    try {
        const response = await apiRequest('/api/monitor/alerts', {
            headers: { 'X-Session-Token': sessionToken || '' }
        });

        if (response.ok) {
            const data = await response.json();
            alertsDiv.innerHTML = data.alerts.length > 0 ? data.alerts.map(a => `
                <div style="margin: 0.5rem 0; padding: 0.5rem; border-left: 3px solid ${a.severity === 'critical' ? '#ff0000' : '#ffaa00'}; color: #ffaa00;">
                    <strong>[${a.severity.toUpperCase()}]</strong> ${a.target}<br>
                    <span style="color: #00aaaa; font-size: 0.9rem;">${a.description} (${new Date(a.timestamp).toLocaleDateString()})</span>
                </div>
            `).join('') : '<span style="color: #00ff00;">No anomalies detected</span>';
        } else {
            alertsDiv.innerHTML = '<span style="color: #ffaa00;">Unable to load alerts</span>';
        }
    } catch (error) {
        alertsDiv.innerHTML = `<span style="color: #ffaa00;">No recent alerts</span>`;
    }
}

// ===== FEATURE 7: EXPLOIT SIMULATION =====
async function assessExploitRisk() {
    const target = document.getElementById('exploit-target')?.value?.trim();
    if (!target) {
        alert('Enter a target to assess');
        return;
    }

    const resultsDiv = document.getElementById('exploit-results');
    resultsDiv.innerHTML = '<span class="terminal-spinner"></span> Assessing exploitation risk...';

    try {
        const response = await apiRequest('/api/exploit/assess', {
            method: 'POST',
            body: JSON.stringify({ target, token: sessionToken })
        });

        if (response.ok) {
            const data = await response.json();
            const scoreColor = data.exploitationScore > 7 ? '#ff0000' : data.exploitationScore > 5 ? '#ffaa00' : '#00ff00';
            resultsDiv.innerHTML = `
                <div style="color: #00ffff; margin-bottom: 1rem;">
                    <strong>Target:</strong> ${data.target}<br>
                    <strong>Risk Level:</strong> <span style="color: ${scoreColor};">${data.riskLevel.toUpperCase()}</span><br>
                    <strong>Exploitation Score:</strong> <span style="color: ${scoreColor};">${data.exploitationScore}/10</span>
                </div>
                <div style="color: #00ff00; margin-bottom: 1rem;">
                    <strong>Vulnerable CVEs:</strong>
                    ${data.cves.map(cve => `<div style="margin-left: 1rem;">• ${cve}</div>`).join('')}
                </div>
                <div style="color: #00ffff;">
                    <strong>Exposed Services:</strong>
                    ${data.services.map(svc => `<div style="margin-left: 1rem;">• ${svc}</div>`).join('')}
                </div>
                <div style="color: #ffaa00; margin-top: 1rem;">
                    <strong>Recommendations:</strong>
                    ${data.recommendations.map(r => `<div style="margin-left: 1rem;">→ ${r}</div>`).join('')}
                </div>
            `;
        } else {
            const error = await response.json();
            resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.error}</span>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.message}</span>`;
    }
}

// ===== FEATURE 8: PRIVACY-PRESERVING AGGREGATOR =====
async function aggregatePrivacy() {
    const batchData = document.getElementById('aggregator-input')?.value?.trim();
    const anonymize = document.getElementById('aggregator-anonymize')?.checked;
    const diffPrivacy = document.getElementById('aggregator-differential-privacy')?.checked;

    if (!batchData) {
        alert('Paste or upload batch data');
        return;
    }

    const resultsDiv = document.getElementById('aggregator-results');
    resultsDiv.innerHTML = '<span class="terminal-spinner"></span> Analyzing batch data with privacy safeguards...';

    try {
        const response = await apiRequest('/api/aggregator/analyze', {
            method: 'POST',
            body: JSON.stringify({ batchData, anonymize, diffPrivacy, token: sessionToken })
        });

        if (response.ok) {
            const data = await response.json();
            resultsDiv.innerHTML = `
                <div style="color: #00ffff; margin-bottom: 1rem;">
                    <strong>Batch Analysis Results</strong><br>
                    <strong>Processed Entries:</strong> ${data.results.processed}<br>
                    <strong>Threats Detected:</strong> <span style="color: #ff0000;">${data.results.threatCount}</span>
                </div>
                <div style="color: #00ff00;">
                    <strong>Risk Distribution:</strong><br>
                    CRITICAL: ${data.results.riskDistribution.critical} | HIGH: ${data.results.riskDistribution.high}<br>
                    MEDIUM: ${data.results.riskDistribution.medium} | LOW: ${data.results.riskDistribution.low}
                </div>
                <div style="color: #00aaff; margin-top: 0.5rem;">
                    <strong>Privacy Mode:</strong> ${data.results.privacyMode}
                </div>
            `;
        } else {
            const error = await response.json();
            resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.error}</span>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<span style="color: #ff0000;">Error: ${error.message}</span>`;
    }
}

// ===== TOOL REFERENCE MANAGEMENT =====
async function loadAllTools() {
    const container = document.getElementById('reference-container');
    if (!container) return;
    
    container.innerHTML = '<span class="terminal-spinner"></span> Loading 53 reference tools by use-case...';
    
    try {
        const data = await apiRequest('/tools/all');
        const tools = data.tools || [];
        
        // Get distinct use-cases
        const useCases = [...new Set(tools.map(t => t.use_case))].sort();
        
        // Build use-case filter dropdown
        const useCaseSelect = document.getElementById('reference-use-case-filter');
        if (useCaseSelect) {
            useCaseSelect.innerHTML = '<option value="all">All use-cases</option>';
            useCases.forEach(useCase => {
                const option = document.createElement('option');
                option.value = useCase;
                option.textContent = useCase;
                useCaseSelect.appendChild(option);
            });
            useCaseSelect.addEventListener('change', () => filterToolsByUseCase(tools, useCaseSelect.value));
        }
        
        // Build category filter dropdown
        const categories = [...new Set(tools.map(t => t.category))].sort();
        const categorySelect = document.getElementById('reference-category-filter');
        if (categorySelect) {
            categorySelect.innerHTML = '<option value="all">All categories</option>';
            categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat;
                option.textContent = cat;
                categorySelect.appendChild(option);
            });
            categorySelect.addEventListener('change', () => filterToolsByCategory(tools, categorySelect.value));
        }
        
        // Display tools
        displayToolsGrid(tools);
        
        // Update stats
        const statsDiv = document.getElementById('reference-stats');
        if (statsDiv) {
            statsDiv.innerHTML = `<strong>${tools.length}</strong> tools across <strong>${useCases.length}</strong> use-cases`;
        }
        
        // Add event listener to search
        const searchInput = document.getElementById('reference-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => searchTools(e.target.value, tools));
        }
    } catch (error) {
        container.innerHTML = `<span style="color: #ff0000;">Error loading tools: ${error.message}</span>`;
    }
}

function displayToolsGrid(tools) {
    const container = document.getElementById('reference-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Group tools by use-case
    const grouped = {};
    tools.forEach(tool => {
        const useCase = tool.use_case || 'General';
        if (!grouped[useCase]) grouped[useCase] = [];
        grouped[useCase].push(tool);
    });
    
    // Display grouped by use-case
    Object.keys(grouped).sort().forEach(useCase => {
        const section = document.createElement('div');
        section.style.marginBottom = '2.5rem';
        
        const header = document.createElement('h3');
        header.style.color = '#52c3ff';
        header.style.marginBottom = '1rem';
        header.style.fontSize = '1.2rem';
        header.style.textTransform = 'uppercase';
        header.style.letterSpacing = '0.05em';
        header.textContent = `${useCase} (${grouped[useCase].length})`;
        section.appendChild(header);
        
        const grid = document.createElement('div');
        grid.className = 'reference-grid';
        
        grouped[useCase].forEach(tool => {
            const card = document.createElement('div');
            card.className = 'reference-item';
            card.style.cursor = 'pointer';
            card.onclick = () => showToolDetails(tool);
            card.innerHTML = `
                <div class="reference-name">${tool.name}</div>
                <div class="reference-desc">${tool.desc}</div>
                <div class="reference-meta">
                    <span class="reference-category">${tool.category}</span>
                    <span class="reference-source">${tool.source}</span>
                </div>
            `;
            grid.appendChild(card);
        });
        
        section.appendChild(grid);
        container.appendChild(section);
    });
}

function showToolDetails(tool) {
    const dialog = document.getElementById('tool-details-dialog');
    const nameEl = document.getElementById('tool-details-name');
    const contentEl = document.getElementById('tool-details-content');
    
    if (!dialog || !nameEl || !contentEl) return;
    
    nameEl.textContent = tool.name;
    contentEl.innerHTML = `
        <div style="color: #b0d4ff; line-height: 1.8; font-size: 0.95rem;">
            <div style="margin-bottom: 1.2rem;">
                <span style="color: #72bfff; font-weight: bold;">Description:</span><br>
                ${tool.desc}
            </div>
            <div style="margin-bottom: 0.8rem;">
                <span style="color: #72bfff; font-weight: bold;">Use-Case:</span><br>
                ${tool.use_case || 'General'}
            </div>
            <div style="margin-bottom: 0.8rem;">
                <span style="color: #72bfff; font-weight: bold;">Category:</span><br>
                ${tool.category}
            </div>
            <div>
                <span style="color: #72bfff; font-weight: bold;">Source:</span><br>
                ${tool.source}
            </div>
        </div>
    `;
    
    dialog.showModal();
}

function closeToolDetailsDialog() {
    const dialog = document.getElementById('tool-details-dialog');
    if (dialog) dialog.close();
}

function filterToolsByUseCase(tools, useCase) {
    if (useCase === 'all') {
        displayToolsGrid(tools);
    } else {
        displayToolsGrid(tools.filter(t => (t.use_case || 'General') === useCase));
    }
}

function filterToolsByCategory(tools, category) {
    if (category === 'all') {
        displayToolsGrid(tools);
    } else {
        displayToolsGrid(tools.filter(t => t.category === category));
    }
}

function searchTools(query, tools) {
    if (!query.trim()) {
        displayToolsGrid(tools);
        return;
    }
    const filtered = tools.filter(t => 
        t.name.toLowerCase().includes(query.toLowerCase()) ||
        t.desc.toLowerCase().includes(query.toLowerCase())
    );
    displayToolsGrid(filtered);
}

// Auto-load tools when reference tab is accessed
window.addEventListener('load', () => {
    setTimeout(() => {
        const refTab = document.getElementById('reference-tab');
        if (refTab && refTab.classList.contains('active')) {
            loadAllTools();
        }
    }, 500);
});

// Initialize feature listeners on page load
document.addEventListener('DOMContentLoaded', () => {
    // Load dossiers when collaboration tab is accessed
    document.getElementById('dossier-list')?.addEventListener('mouseenter', loadDossierList, { once: true });
    document.getElementById('collab-log')?.addEventListener('mouseenter', loadCollaborationLog, { once: true });
    
    // Load monitoring targets when monitor tab is accessed
    document.getElementById('monitor-list')?.addEventListener('mouseenter', loadMonitorTargets, { once: true });

    const collaborateTab = document.getElementById('collaborate-tab');
    if (collaborateTab && collaborateTab.classList.contains('active')) {
        loadDossierList();
        loadCollaborationLog();
    }
});
