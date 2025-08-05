/**
 * Performance Manager
 * Handles batched processing, web worker coordination, and cleanup
 */

class PerformanceManager {
  constructor() {
    this.workers = new Map();
    this.currentJobs = new Map();
    this.entityPools = new Map();
    this.jobCounter = 0;
    
    // Debouncing timers
    this.debounceTimers = new Map();
    
    // Performance monitoring
    this.performanceMetrics = {
      totalTerrainSamples: 0,
      averageProcessingTime: 0,
      memoryUsage: 0
    };
  }

  /**
   * Initialize web workers
   */
  initializeWorkers() {
    // Terrain analysis worker
    const terrainWorker = new Worker('../dependencies/js/terrainWorker.js');
    terrainWorker.onmessage = (e) => this.handleWorkerMessage('terrain', e);
    terrainWorker.onerror = (e) => this.handleWorkerError('terrain', e);
    this.workers.set('terrain', terrainWorker);
    
    console.log('Performance Manager: Workers initialized');
  }

  /**
   * Handle messages from web workers
   */
  handleWorkerMessage(workerType, event) {
    const { type, jobId, ...data } = event.data;
    
    switch (type) {
      case 'progress':
        this.handleProgress(jobId, data);
        break;
        
      case 'terrain_complete':
        this.handleTerrainComplete(jobId, data);
        break;
        
      case 'slopes_complete':
        this.handleSlopesComplete(jobId, data);
        break;
        
      case 'expected_strokes_complete':
        this.handleExpectedStrokesComplete(jobId, data);
        break;
        
      case 'error':
        this.handleWorkerError(workerType, data);
        break;
        
      default:
        console.warn(`Unknown worker message type: ${type}`);
    }
  }

  /**
   * Handle worker errors
   */
  handleWorkerError(workerType, error) {
    console.error(`Worker error (${workerType}):`, error);
    // Could implement retry logic here
  }

  /**
   * Start terrain analysis job
   */
  async startTerrainAnalysis(cartographics, gridDimensions, mask, options = {}) {
    const jobId = ++this.jobCounter;
    const startTime = performance.now();
    
    // Cancel any existing terrain job
    this.cancelJob('terrain');
    
    // Store job info
    this.currentJobs.set('terrain', {
      jobId,
      startTime,
      type: 'terrain',
      callback: options.callback,
      progressCallback: options.progressCallback
    });

    // Send work to terrain worker
    const terrainWorker = this.workers.get('terrain');
    if (terrainWorker) {
      terrainWorker.postMessage({
        type: 'sampleTerrain',
        currentJobId: jobId,
        data: {
          cartographics: Array.from(cartographics), // Convert if needed
          gridDimensions,
          mask: mask ? Array.from(mask) : null,
          smoothing: options.smoothing !== false
        }
      });
    }
    
    return jobId;
  }

  /**
   * Start slope calculation job
   */
  async startSlopeCalculation(elevations, gridDimensions, mask, stepSizeMeters, options = {}) {
    const jobId = ++this.jobCounter;
    
    const terrainWorker = this.workers.get('terrain');
    if (terrainWorker) {
      terrainWorker.postMessage({
        type: 'calculateSlopes',
        currentJobId: jobId,
        data: {
          elevations: Array.from(elevations),
          gridDimensions,
          mask: mask ? Array.from(mask) : null,
          stepSizeMeters
        }
      });
    }
    
    return jobId;
  }

  /**
   * Handle terrain sampling completion
   */
  handleTerrainComplete(jobId, data) {
    const job = this.currentJobs.get('terrain');
    if (job && job.jobId === jobId) {
      const processingTime = performance.now() - job.startTime;
      console.log(`Terrain sampling completed in ${processingTime.toFixed(1)}ms`);
      
      // Update performance metrics
      this.performanceMetrics.totalTerrainSamples += data.processed;
      this.performanceMetrics.averageProcessingTime = 
        (this.performanceMetrics.averageProcessingTime + processingTime) / 2;
      
      // Call completion callback
      if (job.callback) {
        job.callback(data);
      }
      
      this.currentJobs.delete('terrain');
    }
  }

  /**
   * Handle slope calculation completion
   */
  handleSlopesComplete(jobId, data) {
    console.log(`Slope calculation completed: ${data.slopes.length} slopes, ${data.arrows.length} arrows`);
    
    // Emit custom event for slope completion
    window.dispatchEvent(new CustomEvent('slopesCalculated', {
      detail: { jobId, ...data }
    }));
  }

  /**
   * Handle expected strokes completion
   */
  handleExpectedStrokesComplete(jobId, data) {
    console.log(`Expected strokes: ${data.averageStrokes?.toFixed(2)} (${data.validPoints}/${data.totalPoints} valid points)`);
    
    // Emit custom event
    window.dispatchEvent(new CustomEvent('expectedStrokesCalculated', {
      detail: { jobId, ...data }
    }));
  }

  /**
   * Handle progress updates
   */
  handleProgress(jobId, data) {
    const job = Array.from(this.currentJobs.values()).find(j => j.jobId === jobId);
    if (job && job.progressCallback) {
      job.progressCallback(data);
    }
    
    // Emit progress event
    window.dispatchEvent(new CustomEvent('calculationProgress', {
      detail: { jobId, ...data }
    }));
  }

  /**
   * Cancel a job by type
   */
  cancelJob(jobType) {
    const job = this.currentJobs.get(jobType);
    if (job) {
      console.log(`Cancelling ${jobType} job ${job.jobId}`);
      this.currentJobs.delete(jobType);
    }
  }

  /**
   * Debounced function execution with adaptive timing
   */
  debounce(key, func, delay = 400) {
    // Clear existing timer
    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key));
    }
    
    // Adaptive delay based on operation type
    let adaptiveDelay = delay;
    if (key.includes('drag') || key.includes('move') || key.includes('manual-update')) {
      adaptiveDelay = Math.min(delay, 200); // Faster for drag operations
    } else if (key.includes('optimization') || key.includes('analysis')) {
      adaptiveDelay = Math.max(delay, 600); // Slower for heavy operations
    }
    
    // Set new timer
    const timer = setTimeout(() => {
      func();
      this.debounceTimers.delete(key);
    }, adaptiveDelay);
    
    this.debounceTimers.set(key, timer);
  }

  /**
   * Batch process array with progress updates
   */
  async batchProcess(items, processor, batchSize = 50, progressCallback = null) {
    const results = [];
    const total = items.length;
    
    for (let i = 0; i < total; i += batchSize) {
      const batch = items.slice(i, Math.min(i + batchSize, total));
      const batchResults = await Promise.all(batch.map(processor));
      results.push(...batchResults);
      
      // Progress update
      if (progressCallback) {
        progressCallback({
          processed: Math.min(i + batchSize, total),
          total: total,
          progress: Math.min(i + batchSize, total) / total
        });
      }
      
      // Yield control to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    return results;
  }

  /**
   * Entity pool management for reusing Cesium entities
   */
  getEntityFromPool(poolKey, entityFactory) {
    if (!this.entityPools.has(poolKey)) {
      this.entityPools.set(poolKey, []);
    }
    
    const pool = this.entityPools.get(poolKey);
    
    if (pool.length > 0) {
      return pool.pop();
    } else {
      return entityFactory();
    }
  }

  /**
   * Return entity to pool for reuse
   */
  returnEntityToPool(poolKey, entity) {
    if (!this.entityPools.has(poolKey)) {
      this.entityPools.set(poolKey, []);
    }
    
    // Reset entity properties
    entity.show = false;
    if (entity.position) entity.position = undefined;
    if (entity.point) entity.point.color = Cesium.Color.WHITE;
    
    this.entityPools.get(poolKey).push(entity);
  }

  /**
   * Clear entity pool and properly dispose
   */
  clearEntityPool(poolKey, viewer) {
    const pool = this.entityPools.get(poolKey);
    if (pool) {
      pool.forEach(entity => {
        if (viewer && viewer.entities) {
          viewer.entities.remove(entity);
        }
      });
      pool.length = 0;
    }
  }

  /**
   * Memory cleanup
   */
  cleanup() {
    // Cancel all active jobs
    for (const jobType of this.currentJobs.keys()) {
      this.cancelJob(jobType);
    }
    
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    // Terminate workers
    for (const [workerType, worker] of this.workers.entries()) {
      console.log(`Terminating ${workerType} worker`);
      worker.terminate();
    }
    this.workers.clear();
    
    // Clear entity pools
    for (const poolKey of this.entityPools.keys()) {
      this.clearEntityPool(poolKey);
    }
    
    console.log('Performance Manager: Cleanup completed');
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      ...this.performanceMetrics,
      activeJobs: this.currentJobs.size,
      activeWorkers: this.workers.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * Estimate memory usage (rough approximation)
   */
  estimateMemoryUsage() {
    let totalEntities = 0;
    for (const pool of this.entityPools.values()) {
      totalEntities += pool.length;
    }
    
    // Rough estimate: ~1KB per entity
    return totalEntities * 1024;
  }
}

// Global instance
window.performanceManager = new PerformanceManager();