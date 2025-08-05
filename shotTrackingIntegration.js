/**
 * Shot Tracking Integration Module
 * 
 * Connects PLAY panel shot entry to shot data model and skill rating calculations
 * Handles real-time strokes gained analysis during round play
 */

class ShotTrackingIntegration {
  constructor(shotDataModel, skillRatingEngine, aiCaddieGolfModule) {
    this.shotDataModel = shotDataModel;
    this.skillRatingEngine = skillRatingEngine;
    this.golfModule = aiCaddieGolfModule;
    
    // Current round and hole state
    this.currentRound = null;
    this.currentHole = null;
    this.currentHoleNumber = 1;
    this.shotSequence = [];
    this.pinPosition = null;
    
    // Shot entry state
    this.awaitingClick = false;
    this.shotEntryStep = 'pin'; // pin -> shot1 -> shot2 -> shot3 -> finish
    
    this.initializeEventHandlers();
    console.log('Shot Tracking Integration initialized');
  }

  /**
   * Initialize event handlers for PLAY panel integration
   */
  initializeEventHandlers() {
    // Handle shot placement clicks on the viewer
    if (window.viewer) {
      window.viewer.cesiumWidget.canvas.addEventListener('click', (event) => {
        if (this.awaitingClick) {
          this.handleViewerClick(event);
        }
      });
    }
    
    // Handle finish hole button
    const finishHoleBtn = document.getElementById('finishHoleBtn');
    if (finishHoleBtn) {
      finishHoleBtn.addEventListener('click', () => this.finishCurrentHole());
    }
    
    // Handle undo shot button  
    const undoShotBtn = document.getElementById('undoShotBtn');
    if (undoShotBtn) {
      undoShotBtn.addEventListener('click', () => this.undoLastShot());
    }
    
    // Handle club and result selection changes
    const clubSelect = document.getElementById('clubSelect');
    const resultSelect = document.getElementById('resultSelect');
    
    if (clubSelect) {
      clubSelect.addEventListener('change', () => this.updateCurrentShotData());
    }
    
    if (resultSelect) {
      resultSelect.addEventListener('change', () => this.updateCurrentShotData());
    }
  }

  /**
   * Start a new round
   * @param {string} courseId - Course identifier
   * @param {string} courseName - Course name
   * @param {Object} conditions - Course conditions
   */
  startNewRound(courseId, courseName, conditions = {}) {
    this.currentRound = this.shotDataModel.createRound(courseId, courseName, new Date(), conditions);
    this.currentHoleNumber = 1;
    this.startNewHole(1);
    
    console.log(`Started new round: ${courseName} (${this.currentRound.roundId})`);
    
    // Update UI
    this.updatePlayPanelUI();
  }

  /**
   * Start a new hole
   * @param {number} holeNumber - Hole number (1-18)
   * @param {Object} holeInfo - Hole information
   */
  startNewHole(holeNumber, holeInfo = {}) {
    if (!this.currentRound) {
      console.warn('Cannot start hole without active round');
      return;
    }
    
    this.currentHoleNumber = holeNumber;
    this.currentHole = this.shotDataModel.createHole(this.currentRound.roundId, holeNumber, holeInfo);
    this.shotSequence = [];
    this.pinPosition = null;
    this.shotEntryStep = 'pin';
    
    console.log(`Started hole ${holeNumber}`);
    
    // Update UI to show pin placement instruction
    this.updatePlayPanelUI();
    this.enableViewerClick();
  }

  /**
   * Handle clicks on the 3D viewer for shot placement
   * @param {Event} event - Click event
   */
  handleViewerClick(event) {
    if (!window.viewer) return;
    
    // Get click position
    const pickedPosition = window.viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(event.clientX, event.clientY),
      window.viewer.scene.globe.ellipsoid
    );
    
    if (!pickedPosition) return;
    
    const cartographic = Cesium.Cartographic.fromCartesian(pickedPosition);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    
    switch (this.shotEntryStep) {
      case 'pin':
        this.placePinPosition(lat, lon);
        break;
      case 'shot1':
      case 'shot2':
      case 'shot3':
        this.placeShotPosition(lat, lon);
        break;
    }
    
    this.disableViewerClick();
  }

  /**
   * Place pin position for current hole
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   */
  placePinPosition(lat, lon) {
    this.pinPosition = { lat, lon };
    this.currentHole.pinPosition = this.pinPosition;
    
    // Add visual marker for pin
    this.addPinMarker(lat, lon);
    
    // Move to first shot entry
    this.shotEntryStep = 'shot1';
    this.updatePlayPanelUI();
    
    console.log(`Pin placed at: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
  }

  /**
   * Place shot position and create shot data
   * @param {number} lat - Latitude  
   * @param {number} lon - Longitude
   */
  async placeShotPosition(lat, lon) {
    if (!this.pinPosition) {
      console.warn('Pin must be placed before shot entry');
      return;
    }
    
    const shotNumber = this.shotSequence.length + 1;
    
    // Get starting position (previous shot end or tee)
    let startLat, startLon, startCourseFeature;
    if (shotNumber === 1) {
      // First shot - estimate tee position (for now, use clicked position as approximation)
      startLat = lat;
      startLon = lon;
      startCourseFeature = 'tee';
    } else {
      const previousShot = this.shotSequence[this.shotSequence.length - 1];
      startLat = previousShot.endPosition.lat;
      startLon = previousShot.endPosition.lon;
      startCourseFeature = previousShot.endPosition.courseFeature;
    }
    
    // Calculate distances using existing golf module
    const distanceToPin = this.calculateDistance(lat, lon, this.pinPosition.lat, this.pinPosition.lon);
    const startDistanceToPin = shotNumber === 1 ? 
      this.calculateDistance(startLat, startLon, this.pinPosition.lat, this.pinPosition.lon) : 
      this.shotSequence[this.shotSequence.length - 1].distances.distanceToTargetAfter;
    
    // Identify course features using existing system
    const startFeature = this.golfModule ? 
      this.golfModule.identifyCourseFeature(startLon, startLat) : startCourseFeature;
    const endFeature = this.golfModule ? 
      this.golfModule.identifyCourseFeature(lon, lat) : 'rough';
    
    // Calculate expected strokes using existing system
    let expectedStrokesBefore = null;
    let expectedStrokesAfter = null;
    
    if (this.golfModule) {
      expectedStrokesBefore = this.golfModule.calculateExpectedStrokesWithPenalties(
        this.yardsToMeters(startDistanceToPin), startLon, startLat
      );
      expectedStrokesAfter = this.golfModule.calculateExpectedStrokesWithPenalties(
        this.yardsToMeters(distanceToPin), lon, lat
      );
    }
    
    // Create shot data structure
    const shotData = this.shotDataModel.createShot({
      shotNumber,
      startLat,
      startLon,
      endLat: lat,
      endLon: lon,
      startCourseFeature: startFeature,
      endCourseFeature: endFeature,
      distanceToTarget: startDistanceToPin,
      distanceToTargetAfter: distanceToPin,
      totalDistance: shotNumber === 1 ? this.calculateDistance(startLat, startLon, lat, lon) : null,
      expectedStrokesBefore,
      expectedStrokesAfter,
      clubType: document.getElementById('clubSelect')?.value || null,
      shotQuality: document.getElementById('resultSelect')?.value || 'average',
      greenInRegulation: endFeature === 'green' && shotNumber <= (this.currentHole.par - 2),
      fairwayHit: shotNumber === 1 && endFeature === 'fairway'
    });
    
    // Add shot to hole
    this.shotSequence.push(shotData);
    this.shotDataModel.addShotToHole(this.currentRound.roundId, this.currentHoleNumber, shotData);
    
    // Add visual markers
    this.addShotMarker(startLat, startLon, lat, lon, shotNumber);
    
    // Update UI for next shot or finish hole
    if (distanceToPin < 5 || shotNumber >= 6) { // Close to hole or max shots
      this.shotEntryStep = 'finish';
      this.enableFinishHole();
    } else {
      this.shotEntryStep = `shot${shotNumber + 1}`;
      this.updatePlayPanelUI();
    }
    
    // Update real-time statistics
    this.updateRealTimeStats();
    
    console.log(`Shot ${shotNumber} recorded: ${distanceToPin.toFixed(1)} yards from pin`);
  }

  /**
   * Update current shot data when club/result changes
   */
  updateCurrentShotData() {
    if (this.shotSequence.length === 0) return;
    
    const currentShot = this.shotSequence[this.shotSequence.length - 1];
    const clubSelect = document.getElementById('clubSelect');
    const resultSelect = document.getElementById('resultSelect');
    
    if (clubSelect?.value) {
      currentShot.club.type = clubSelect.value;
      currentShot.club.category = this.shotDataModel.categorizeClub(clubSelect.value);
      
      // Update fairway hit for drives
      if (currentShot.shotNumber === 1 && clubSelect.value === 'driver') {
        currentShot.result.fairwayHit = currentShot.endPosition.courseFeature === 'fairway';
      }
    }
    
    if (resultSelect?.value) {
      currentShot.result.quality = resultSelect.value;
    }
    
    // Recalculate hole statistics
    this.shotDataModel.updateHoleStrokesGained(this.currentHole);
    this.updateRealTimeStats();
  }

  /**
   * Finish current hole and move to next
   */
  finishCurrentHole() {
    if (!this.currentHole || this.shotSequence.length === 0) return;
    
    // Mark hole as completed
    this.currentHole.completed = true;
    this.currentHole.score = this.shotSequence.length;
    
    // Update round totals
    this.updateRoundTotals();
    
    // Move to next hole or finish round
    if (this.currentHoleNumber < 18) {
      this.startNewHole(this.currentHoleNumber + 1);
    } else {
      this.finishRound();
    }
    
    console.log(`Finished hole ${this.currentHoleNumber} in ${this.shotSequence.length} shots`);
  }

  /**
   * Undo last shot
   */
  undoLastShot() {
    if (this.shotSequence.length === 0) return;
    
    // Remove last shot
    const removedShot = this.shotSequence.pop();
    this.currentHole.shots.pop();
    
    // Remove visual marker
    this.removeShotMarker(removedShot.shotNumber);
    
    // Update shot entry step
    if (this.shotSequence.length === 0) {
      this.shotEntryStep = 'shot1';
    } else {
      this.shotEntryStep = `shot${this.shotSequence.length + 1}`;
    }
    
    // Update UI
    this.updatePlayPanelUI();
    this.updateRealTimeStats();
    
    console.log(`Undid shot ${removedShot.shotNumber}`);
  }

  /**
   * Update round totals and skill ratings
   */
  updateRoundTotals() {
    if (!this.currentRound) return;
    
    // Calculate round totals
    let totalScore = 0;
    let totalStrokesGained = { offTheTee: 0, approach: 0, aroundTheGreen: 0, putting: 0 };
    
    this.currentRound.holes.forEach(hole => {
      if (hole.completed) {
        totalScore += hole.score;
        totalStrokesGained.offTheTee += hole.strokesGained.offTheTee;
        totalStrokesGained.approach += hole.strokesGained.approach;
        totalStrokesGained.aroundTheGreen += hole.strokesGained.aroundTheGreen;
        totalStrokesGained.putting += hole.strokesGained.putting;
      }
    });
    
    this.currentRound.totalScore = totalScore;
    this.currentRound.strokesGained = {
      ...totalStrokesGained,
      total: totalStrokesGained.offTheTee + totalStrokesGained.approach + 
             totalStrokesGained.aroundTheGreen + totalStrokesGained.putting
    };
    
    // Update skill ratings if we have enough data
    if (this.skillRatingEngine) {
      this.currentRound.skillRatings = this.skillRatingEngine.calculateAllSkillRatings(this.currentRound.roundId);
    }
  }

  /**
   * Update real-time statistics display
   */
  updateRealTimeStats() {
    // Update PROFILE panel with latest skill ratings
    if (this.skillRatingEngine) {
      const ratings = this.skillRatingEngine.calculateAllSkillRatings();
      this.updateProfilePanelRatings(ratings);
    }
    
    // Update current shot details display
    this.updateCurrentShotDisplay();
  }

  /**
   * Update PROFILE panel with skill ratings
   * @param {Object} ratings - Skill ratings
   */
  updateProfilePanelRatings(ratings) {
    // This will be implemented when we add the UI components
    console.log('Updated skill ratings:', ratings);
  }

  /**
   * Update current shot details display
   */
  updateCurrentShotDisplay() {
    const currentShotDetails = document.getElementById('currentShotDetails');
    if (!currentShotDetails) return;
    
    if (this.shotSequence.length === 0) {
      currentShotDetails.innerHTML = `
        <div class="text-center text-muted">
          <small>Place pin to begin shot entry</small>
        </div>
      `;
      return;
    }
    
    const lastShot = this.shotSequence[this.shotSequence.length - 1];
    const distanceToPin = lastShot.distances.distanceToTargetAfter;
    
    currentShotDetails.innerHTML = `
      <div class="row">
        <div class="col-6">
          <div class="stat-value">${lastShot.shotNumber}</div>
          <div class="stat-label">Shot #</div>
        </div>
        <div class="col-6">
          <div class="stat-value">${distanceToPin?.toFixed(0) || '--'}</div>
          <div class="stat-label">Yards to Pin</div>
        </div>
      </div>
      ${lastShot.expectedStrokes.gained !== null ? `
        <div class="mt-2">
          <div class="stat-value ${lastShot.expectedStrokes.gained > 0 ? 'text-success' : 'text-danger'}">
            ${lastShot.expectedStrokes.gained > 0 ? '+' : ''}${lastShot.expectedStrokes.gained.toFixed(2)}
          </div>
          <div class="stat-label">Strokes Gained</div>
        </div>
      ` : ''}
    `;
  }

  /**
   * Update PLAY panel UI based on current state
   */
  updatePlayPanelUI() {
    const instructions = document.getElementById('shotInstructions');
    const clubSelect = document.getElementById('clubSelect');
    const resultSelect = document.getElementById('resultSelect');
    
    switch (this.shotEntryStep) {
      case 'pin':
        if (instructions) {
          instructions.innerHTML = `
            <div class="instruction-content">
              <div class="instruction-icon">
                <i class="bi bi-flag-fill" style="font-size: 36px; color: var(--accent-success);"></i>
              </div>
              <h4>Step 1: Place the Pin</h4>
              <p class="text-muted">Click on the green to mark the pin location for this hole</p>
            </div>
          `;
        }
        this.disableControls();
        break;
        
      case 'shot1':
      case 'shot2':
      case 'shot3':
        const shotNum = parseInt(this.shotEntryStep.replace('shot', ''));
        if (instructions) {
          instructions.innerHTML = `
            <div class="instruction-content">
              <div class="instruction-icon">
                <i class="bi bi-${shotNum}-circle" style="font-size: 36px; color: var(--accent-primary);"></i>
              </div>
              <h4>Shot ${shotNum}: ${shotNum === 1 ? 'Tee Shot' : 'Next Shot'}</h4>
              <p class="text-muted">Click where your ball ${shotNum === 1 ? 'landed after your tee shot' : 'ended up'}</p>
            </div>
          `;
        }
        this.enableControls();
        break;
        
      case 'finish':
        if (instructions) {
          instructions.innerHTML = `
            <div class="instruction-content">
              <div class="instruction-icon">
                <i class="bi bi-check-circle" style="font-size: 36px; color: var(--accent-success);"></i>
              </div>
              <h4>Hole Complete</h4>
              <p class="text-muted">Click "Finish Hole" to move to the next hole</p>
            </div>
          `;
        }
        this.enableFinishHole();
        break;
    }
  }

  /**
   * Enable/disable UI controls
   */
  enableControls() {
    document.getElementById('clubSelect')?.removeAttribute('disabled');
    document.getElementById('resultSelect')?.removeAttribute('disabled');
  }
  
  disableControls() {
    document.getElementById('clubSelect')?.setAttribute('disabled', 'true');
    document.getElementById('resultSelect')?.setAttribute('disabled', 'true');
  }
  
  enableFinishHole() {
    document.getElementById('finishHoleBtn')?.removeAttribute('disabled');
  }
  
  enableViewerClick() {
    this.awaitingClick = true;
  }
  
  disableViewerClick() {
    this.awaitingClick = false;
  }

  /**
   * Helper functions
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    // Simple distance calculation in yards (Haversine formula)
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in meters
    return distance * 1.09361; // Convert to yards
  }
  
  yardsToMeters(yards) {
    return yards * 0.9144;
  }
  
  metersToYards(meters) {
    return meters * 1.09361;
  }
  
  addPinMarker(lat, lon) {
    // Add visual pin marker (to be implemented with Cesium)
    console.log(`Pin marker added at ${lat}, ${lon}`);
  }
  
  addShotMarker(startLat, startLon, endLat, endLon, shotNumber) {
    // Add visual shot line and marker (to be implemented with Cesium)
    console.log(`Shot ${shotNumber} marker added from ${startLat}, ${startLon} to ${endLat}, ${endLon}`);
  }
  
  removeShotMarker(shotNumber) {
    // Remove visual shot marker (to be implemented with Cesium)
    console.log(`Shot ${shotNumber} marker removed`);
  }
  
  finishRound() {
    if (!this.currentRound) return;
    
    this.currentRound.completed = true;
    console.log(`Round completed: ${this.currentRound.totalScore} total score`);
    
    // Save round data (to be implemented with persistence)
    this.saveRoundData();
  }
  
  saveRoundData() {
    // Save to localStorage or send to server
    const roundData = this.shotDataModel.exportRound(this.currentRound.roundId);
    localStorage.setItem(`ai_caddie_round_${this.currentRound.roundId}`, JSON.stringify(roundData));
    console.log('Round data saved');
  }
}

// Global instance - will be initialized when dependencies are ready
window.shotTrackingIntegration = null;

// Initialize when all dependencies are ready
document.addEventListener('DOMContentLoaded', function() {
  // Wait for all dependencies
  const checkDependencies = () => {
    if (window.shotDataModel && window.skillRatingEngine && window.aiCaddieGolf) {
      window.shotTrackingIntegration = new ShotTrackingIntegration(
        window.shotDataModel,
        window.skillRatingEngine,
        window.aiCaddieGolf
      );
      console.log('Shot Tracking Integration initialized with all dependencies');
    } else {
      // Check again in 100ms
      setTimeout(checkDependencies, 100);
    }
  };
  
  checkDependencies();
});

console.log('Shot Tracking Integration class loaded successfully');