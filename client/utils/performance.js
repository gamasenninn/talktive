// パフォーマンス測定とログ出力
export class PerformanceMonitor {
  constructor() {
    this.metrics = {
      audioLatency: [],
      memoryUsage: [],
      connectionTime: [],
      vadResponseTime: []
    };
    this.startTime = null;
  }

  // 音声遅延測定開始
  startAudioLatencyMeasurement() {
    this.startTime = performance.now();
    performance.mark('audio-start');
  }

  // 音声遅延測定終了
  endAudioLatencyMeasurement() {
    if (!this.startTime) return null;
    
    const latency = performance.now() - this.startTime;
    this.metrics.audioLatency.push(latency);
    performance.mark('audio-end');
    performance.measure('audio-latency', 'audio-start', 'audio-end');
    
    console.log(`🎵 Audio Latency: ${latency.toFixed(2)}ms`);
    return latency;
  }

  // メモリ使用量測定
  measureMemoryUsage() {
    if (!performance.memory) {
      console.warn('performance.memory not available');
      return null;
    }

    const memory = {
      used: performance.memory.usedJSHeapSize / 1024 / 1024,
      total: performance.memory.totalJSHeapSize / 1024 / 1024,
      limit: performance.memory.jsHeapSizeLimit / 1024 / 1024
    };

    this.metrics.memoryUsage.push(memory);
    console.log(`🧠 Memory: ${memory.used.toFixed(1)}MB / ${memory.total.toFixed(1)}MB`);
    
    return memory;
  }

  // AudioContext情報取得
  getAudioContextInfo(audioContext) {
    if (!audioContext) return null;

    const info = {
      sampleRate: audioContext.sampleRate,
      baseLatency: audioContext.baseLatency * 1000, // ms
      outputLatency: audioContext.outputLatency * 1000, // ms
      state: audioContext.state
    };

    console.log(`🔊 AudioContext Info:`, info);
    return info;
  }

  // VAD応答時間測定
  measureVADResponse() {
    performance.mark('vad-trigger');
    return () => {
      performance.mark('vad-response');
      performance.measure('vad-latency', 'vad-trigger', 'vad-response');
      
      const latency = performance.getEntriesByName('vad-latency')[0]?.duration || 0;
      this.metrics.vadResponseTime.push(latency);
      console.log(`🎤 VAD Response: ${latency.toFixed(2)}ms`);
      return latency;
    };
  }

  // 統計サマリー出力
  getStatsSummary() {
    const stats = {};
    
    Object.keys(this.metrics).forEach(key => {
      const values = this.metrics[key];
      if (values.length === 0) return;
      
      const latencies = values.map(v => typeof v === 'number' ? v : v.used || 0);
      stats[key] = {
        count: latencies.length,
        avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        min: Math.min(...latencies),
        max: Math.max(...latencies)
      };
    });

    console.log('📊 Performance Summary:', stats);
    return stats;
  }

  // パフォーマンスエントリをクリア
  clearMetrics() {
    this.metrics = {
      audioLatency: [],
      memoryUsage: [],
      connectionTime: [],
      vadResponseTime: []
    };
    performance.clearMarks();
    performance.clearMeasures();
  }

  // 定期的なメモリ監視開始
  startMemoryMonitoring(intervalMs = 5000) {
    const monitor = () => {
      this.measureMemoryUsage();
      setTimeout(monitor, intervalMs);
    };
    monitor();
  }
}

// WebRTC統計情報取得
export async function getWebRTCStats(peerConnection) {
  if (!peerConnection) return null;

  try {
    const stats = await peerConnection.getStats();
    const audioStats = {};
    
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
        audioStats.inbound = {
          packetsReceived: report.packetsReceived,
          packetsLost: report.packetsLost,
          jitter: report.jitter * 1000, // ms
          audioLevel: report.audioLevel
        };
      }
      
      if (report.type === 'outbound-rtp' && report.mediaType === 'audio') {
        audioStats.outbound = {
          packetsSent: report.packetsSent,
          bytesSent: report.bytesSent
        };
      }
    });

    console.log('🌐 WebRTC Audio Stats:', audioStats);
    return audioStats;
  } catch (error) {
    console.error('Failed to get WebRTC stats:', error);
    return null;
  }
}

// グローバルパフォーマンス監視インスタンス
export const perfMonitor = new PerformanceMonitor();