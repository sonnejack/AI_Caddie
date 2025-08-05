/**
 * Terrain Analysis Web Worker
 * Handles heavy terrain sampling and slope calculations off the main thread
 */

// Worker state
let jobId = 0;

// Message handler
self.onmessage = async function(e) {
  const { 
    type, 
    data, 
    currentJobId 
  } = e.data;

  // Update job ID to handle cancellation
  jobId = currentJobId;

  try {
    switch (type) {
      case 'sampleTerrain':
        await handleTerrainSampling(data, currentJobId);
        break;
        
      case 'calculateSlopes':
        await handleSlopeCalculation(data, currentJobId);
        break;
        
      case 'advancedExpectedStrokes':
        await handleAdvancedExpectedStrokes(data, currentJobId);
        break;
        
      default:
        self.postMessage({
          type: 'error',
          jobId: currentJobId,
          error: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      jobId: currentJobId,
      error: error.message,
      stack: error.stack
    });
  }
};

/**
 * Handle terrain sampling for slope visualization
 */
async function handleTerrainSampling(data, currentJobId) {
  const { 
    cartographics, 
    gridDimensions,
    mask,
    smoothing = true 
  } = data;

  // Check if job was cancelled
  if (jobId !== currentJobId) {
    return;
  }

  // Progress tracking
  let processed = 0;
  const total = cartographics.length;
  const progressInterval = Math.max(1, Math.floor(total / 20)); // 20 progress updates

  // Simulate terrain sampling (in real implementation, this would interface with Cesium)
  // For now, we'll create mock elevation data
  const elevations = new Float32Array(cartographics.length);
  
  for (let i = 0; i < cartographics.length; i++) {
    // Check cancellation periodically
    if (jobId !== currentJobId && i % 100 === 0) {
      return;
    }

    // Mock elevation calculation (replace with real Cesium terrain sampling)
    const carto = cartographics[i];
    elevations[i] = mockElevationSample(carto.longitude, carto.latitude);
    
    processed++;
    
    // Send progress updates
    if (processed % progressInterval === 0) {
      self.postMessage({
        type: 'progress',
        jobId: currentJobId,
        phase: 'terrain_sampling',
        progress: processed / total,
        message: `Sampled ${processed}/${total} terrain points`
      });
    }
  }

  // Apply smoothing if requested
  let finalElevations = elevations;
  if (smoothing && gridDimensions) {
    self.postMessage({
      type: 'progress',
      jobId: currentJobId,
      phase: 'smoothing',
      progress: 0,
      message: 'Smoothing elevation data...'
    });
    
    finalElevations = smoothGrid(elevations, gridDimensions.rows, gridDimensions.cols, mask);
  }

  // Return results
  self.postMessage({
    type: 'terrain_complete',
    jobId: currentJobId,
    elevations: finalElevations,
    processed: processed
  });
}

/**
 * Handle slope calculation from elevation data
 */
async function handleSlopeCalculation(data, currentJobId) {
  const { 
    elevations, 
    gridDimensions, 
    mask,
    stepSizeMeters 
  } = data;

  const { rows, cols } = gridDimensions;
  const slopes = [];
  const arrows = [];

  for (let i = 1; i < rows - 1; i++) {
    for (let j = 1; j < cols - 1; j++) {
      const idx = i * cols + j;
      
      // Skip if not valid grid point
      if (mask && !mask[idx]) continue;
      
      const zc = elevations[idx];
      if (!Number.isFinite(zc)) continue;
      
      // Get neighboring elevations
      const zL = elevations[i * cols + (j - 1)];
      const zR = elevations[i * cols + (j + 1)];
      const zB = elevations[(i - 1) * cols + j];
      const zT = elevations[(i + 1) * cols + j];
      
      if (![zL, zR, zB, zT].every(Number.isFinite)) continue;

      // Calculate slope
      const dzdx = (zR - zL) / (2 * stepSizeMeters);
      const dzdy = (zT - zB) / (2 * stepSizeMeters);
      const slopeX = -dzdx;
      const slopeY = -dzdy;
      const magnitude = Math.hypot(slopeX, slopeY);
      
      if (magnitude < 1e-6) continue;

      const slopePercent = magnitude * 100;
      
      slopes.push({
        row: i,
        col: j,
        magnitude: magnitude,
        slopePercent: slopePercent,
        direction: Math.atan2(slopeY, slopeX)
      });

      // Create arrow data for visualization
      arrows.push({
        row: i,
        col: j,
        slopeX: slopeX,
        slopeY: slopeY,
        magnitude: magnitude,
        slopePercent: slopePercent
      });
    }
  }

  self.postMessage({
    type: 'slopes_complete',
    jobId: currentJobId,
    slopes: slopes,
    arrows: arrows
  });
}

/**
 * Mock elevation sampling (replace with real Cesium integration)
 */
function mockElevationSample(longitude, latitude) {
  // Simple sine wave pattern for demonstration
  const x = longitude * 1000;
  const y = latitude * 1000;
  return 100 + 20 * Math.sin(x * 0.01) * Math.cos(y * 0.01) + 5 * Math.random();
}

/**
 * 3x3 smoothing filter for elevation grid
 */
function smoothGrid(elevations, rows, cols, mask) {
  const smoothed = new Float32Array(elevations.length);
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      
      let sum = 0;
      let count = 0;
      
      // 3x3 kernel
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          
          const neighborIdx = rr * cols + cc;
          const value = elevations[neighborIdx];
          
          if (Number.isFinite(value) && (!mask || mask[neighborIdx])) {
            sum += value;
            count++;
          }
        }
      }
      
      smoothed[idx] = count > 0 ? sum / count : NaN;
    }
  }
  
  return smoothed;
}

/**
 * Handle advanced expected strokes calculation with terrain data
 */
async function handleAdvancedExpectedStrokes(data, currentJobId) {
  const {
    samplePoints,
    pinPosition,
    courseFeatures,
    terrainData
  } = data;

  // This will be expanded to include elevation-aware calculations
  // For now, return basic calculation with progress updates
  
  let totalStrokes = 0;
  let validPoints = 0;
  
  const total = samplePoints.length;
  const progressInterval = Math.max(1, Math.floor(total / 10));
  
  for (let i = 0; i < samplePoints.length; i++) {
    if (jobId !== currentJobId && i % 50 === 0) {
      return; // Job cancelled
    }
    
    const point = samplePoints[i];
    
    // Basic calculation for now (will be enhanced with terrain data)
    const feature = identifyFeature(point, courseFeatures);
    const distance = calculateDistance(point, pinPosition);
    const strokes = getStrokesForFeature(feature, distance);
    
    if (strokes !== null) {
      totalStrokes += strokes;
      validPoints++;
    }
    
    // Progress update
    if (i % progressInterval === 0) {
      self.postMessage({
        type: 'progress',
        jobId: currentJobId,
        phase: 'expected_strokes',
        progress: i / total,
        message: `Processed ${i}/${total} sample points`
      });
    }
  }
  
  const averageStrokes = validPoints > 0 ? totalStrokes / validPoints : null;
  
  self.postMessage({
    type: 'expected_strokes_complete',
    jobId: currentJobId,
    averageStrokes: averageStrokes,
    validPoints: validPoints,
    totalPoints: samplePoints.length
  });
}

// Helper functions (simplified versions of main thread functions)
function identifyFeature(point, courseFeatures) {
  // Simplified feature identification
  // In practice, you'd pass polygon data to worker
  return 'fairway'; // Placeholder
}

function calculateDistance(point1, point2) {
  // Simplified distance calculation
  const dx = point1.x - point2.x;
  const dy = point1.y - point2.y;
  const dz = point1.z - point2.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function getStrokesForFeature(feature, distance) {
  // Simplified strokes calculation
  const distanceYards = distance * 1.09361;
  
  switch (feature) {
    case 'green': return 1 + Math.min(distanceYards / 30, 1.5);
    case 'fairway': return 2.0 + distanceYards / 150;
    case 'rough': return 2.4 + distanceYards / 120;
    case 'bunker': return 2.8 + distanceYards / 100;
    default: return 4.0 + distanceYards / 180;
  }
}