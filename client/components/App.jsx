import { useEffect, useRef, useState, useCallback } from "react";
import logo from "/assets/openai-logomark.svg";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const [isPushToTalkEnabled, setIsPushToTalkEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const peerConnection = useRef(null);
  const audioElement = useRef(null);
  const localStream = useRef(null);
  const spaceKeyTimer = useRef(null);
  const isRecordingRef = useRef(false);
  const defaultModel = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-realtime-preview-2024-12-17";
  const [selectedModel, setSelectedModel] = useState(defaultModel);
  
  // 環境変数からPush-to-Talk制限時間を取得（デフォルト5秒）
  const pushToTalkTimeLimit = parseInt(import.meta.env.VITE_PUSH_TO_TALK_TIME_LIMIT) || 5000;
  
  // 環境変数からVADスレッショルド設定を取得
  const vadThresholdDefault = parseFloat(import.meta.env.VITE_VAD_THRESHOLD_DEFAULT) || 0.5;
  const vadThresholdMin = parseFloat(import.meta.env.VITE_VAD_THRESHOLD_MIN) || 0.0;
  const vadThresholdMax = parseFloat(import.meta.env.VITE_VAD_THRESHOLD_MAX) || 1.0;
  const vadThresholdStep = parseFloat(import.meta.env.VITE_VAD_THRESHOLD_STEP) || 0.01;
  
  // VADスレッショルドの初期値を環境変数から設定
  const [vadThreshold, setVadThreshold] = useState(vadThresholdDefault);

  // Send a message to the model
  const sendClientEvent = useCallback((message) => {
    if (dataChannel) {
      const timestamp = new Date().toLocaleTimeString();
      const messageWithId = {
        ...message,
        event_id: message.event_id || crypto.randomUUID()
      };

      // send event before setting timestamp since the backend peer doesn't expect this field
      dataChannel.send(JSON.stringify(messageWithId));
      console.log("📤 Sent event:", messageWithId.type);

      // if guard just in case the timestamp exists by miracle
      if (!messageWithId.timestamp) {
        messageWithId.timestamp = timestamp;
      }
      setEvents((prev) => [messageWithId, ...prev]);
    } else {
      console.error(
        "Failed to send message - no data channel available",
        message,
      );
    }
  }, [dataChannel]);

  // マイクの有効/無効を切り替える
  const toggleMicrophone = useCallback((enabled) => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = enabled;
        console.log(`🎤 Microphone ${enabled ? 'enabled' : 'disabled'}`);
      } else {
        console.log("❌ No audio track found");
      }
    } else {
      console.log("❌ No local stream found");
    }
  }, []);

  // VAD設定を送信する関数
  const updateVADSettings = useCallback(() => {
    if (dataChannel && dataChannel.readyState === 'open' && !isPushToTalkEnabled) {
      console.log(`🎛️ Updating VAD threshold to: ${vadThreshold} (env default: ${vadThresholdDefault})`);
      const vadEvent = {
        type: "session.update",
        session: {
          input_audio_transcription: {
            model: "whisper-1"
          },
          turn_detection: {
            type: "server_vad",
            threshold: vadThreshold,
            prefix_padding_ms: 300,
            silence_duration_ms: vadThreshold > 0.7 ? 1000 : 500 // 高いスレッショルド時は長い無音時間
          }
        }
      };
      
      sendClientEvent(vadEvent);
      console.log(`✅ VAD settings sent: threshold=${vadThreshold}, silence_duration=${vadThreshold > 0.7 ? 1000 : 500}ms`);
    } else {
      console.log(`❌ Cannot update VAD settings - Push-to-Talk: ${isPushToTalkEnabled}, DataChannel: ${dataChannel?.readyState}`);
    }
  }, [dataChannel, vadThreshold, sendClientEvent, isPushToTalkEnabled, vadThresholdDefault]);

  // 録音停止
  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) {
      console.log("⚠️ stopRecording called but not recording");
      return;
    }
    
    console.log("📢 stopRecording called");
    
    // タイマーをクリア
    if (spaceKeyTimer.current) {
      clearTimeout(spaceKeyTimer.current);
      spaceKeyTimer.current = null;
    }
    
    isRecordingRef.current = false;
    setIsRecording(false);
    
    // マイクを無効にする
    toggleMicrophone(false);
    
    // OpenAI Realtime APIにレスポンス生成を要求
    sendClientEvent({
      type: "response.create"
    });
    
    console.log("🛑 Recording stopped");
  }, [toggleMicrophone, sendClientEvent]);

  // 録音開始
  const startRecording = useCallback(() => {
    if (!isSessionActive || !dataChannel || isRecordingRef.current) {
      console.log("❌ Cannot start recording:", { isSessionActive, hasDataChannel: !!dataChannel, isRecording: isRecordingRef.current });
      return;
    }
    
    console.log("📢 startRecording called");
    isRecordingRef.current = true;
    setIsRecording(true);
    
    // マイクを有効にする
    toggleMicrophone(true);
    
    // 環境変数で設定された時間後に自動的に停止するタイマーを設定（安全装置）
    if (spaceKeyTimer.current) {
      clearTimeout(spaceKeyTimer.current);
    }
    spaceKeyTimer.current = setTimeout(() => {
      console.log(`⏰ Timer: Auto-stopping recording after ${pushToTalkTimeLimit}ms`);
      stopRecording();
    }, pushToTalkTimeLimit);
    
    console.log(`✅ Recording started (auto-stop in ${pushToTalkTimeLimit}ms)`);
  }, [isSessionActive, dataChannel, toggleMicrophone, stopRecording, pushToTalkTimeLimit]);

  // キーボードイベントの処理
  useEffect(() => {
    if (!isPushToTalkEnabled || !isSessionActive) {
      console.log("🚫 Keyboard events disabled", { isPushToTalkEnabled, isSessionActive });
      return;
    }

    console.log("🎯 Setting up keyboard events");

    const handleKeyDown = (event) => {
      console.log("⌨️ Key down:", event.code, "Repeat:", event.repeat, "Recording:", isRecordingRef.current);
      
      if (event.code === 'Space' && !event.repeat && !isRecordingRef.current) {
        event.preventDefault();
        console.log("🔴 Space DOWN - calling startRecording");
        startRecording();
      }
    };

    const handleKeyUp = (event) => {
      console.log("⌨️ Key up:", event.code, "Recording:", isRecordingRef.current);
      
      if (event.code === 'Space' && isRecordingRef.current) {
        event.preventDefault();
        console.log("🔵 Space UP - calling stopRecording");
        stopRecording();
      }
    };

    // windowとdocumentの両方にイベントリスナーを追加
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);

    return () => {
      console.log("🧹 Cleaning up keyboard events");
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
      
      // タイマーもクリア
      if (spaceKeyTimer.current) {
        clearTimeout(spaceKeyTimer.current);
        spaceKeyTimer.current = null;
      }
    };
  }, [isPushToTalkEnabled, isSessionActive, startRecording, stopRecording]);

  // Push-to-Talkモードの切り替え
  const togglePushToTalk = useCallback(() => {
    const newMode = !isPushToTalkEnabled;
    setIsPushToTalkEnabled(newMode);
    
    console.log("🔄 Push-to-Talk mode:", newMode);
    
    // 録音状態をリセット
    isRecordingRef.current = false;
    setIsRecording(false);
    
    if (spaceKeyTimer.current) {
      clearTimeout(spaceKeyTimer.current);
      spaceKeyTimer.current = null;
    }
    
    if (newMode) {
      // Push-to-Talkモード: デフォルトでマイクを無効にする
      toggleMicrophone(false);
    } else {
      // 常時録音モード: マイクを有効にする
      toggleMicrophone(true);
    }
  }, [isPushToTalkEnabled, toggleMicrophone]);

  // VADスレッショルドをデフォルト値にリセットする関数
  const resetVadThreshold = useCallback(() => {
    setVadThreshold(vadThresholdDefault);
    console.log(`🔄 VAD threshold reset to default: ${vadThresholdDefault}`);
  }, [vadThresholdDefault]);

  // VADスレッショルドのバリデーション
  const validateAndSetVadThreshold = useCallback((value) => {
    const clampedValue = Math.max(vadThresholdMin, Math.min(vadThresholdMax, value));
    setVadThreshold(clampedValue);
    if (value !== clampedValue) {
      console.warn(`⚠️ VAD threshold clamped from ${value} to ${clampedValue} (range: ${vadThresholdMin}-${vadThresholdMax})`);
    }
  }, [vadThresholdMin, vadThresholdMax]);

  async function startSession() {
    console.log("🚀 Starting session...");
    
    // Get a session token for OpenAI Realtime API
    const tokenResponse = await fetch("/token");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.client_secret.value;

    // Create a peer connection
    const pc = new RTCPeerConnection();

    // Set up to play remote audio from the model
    audioElement.current = document.createElement("audio");
    audioElement.current.autoplay = true;
    audioElement.current.volume = 1.0; // 音量を明示的に設定
    console.log("🔊 Audio element created:", audioElement.current);
    
    pc.ontrack = (e) => {
      console.log("📡 Received audio track:", e.streams[0]);
      audioElement.current.srcObject = e.streams[0];
      console.log("🔊 Audio source set:", audioElement.current.srcObject);
      
      // 音声再生を強制的に開始
      audioElement.current.play().then(() => {
        console.log("✅ Audio playback started successfully");
      }).catch((error) => {
        console.error("❌ Audio playback failed:", error);
      });
    };

    // Add local audio track for microphone input in the browser
    const ms = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    
    localStream.current = ms;
    const audioTrack = ms.getTracks()[0];
    
    console.log("🎤 Audio track created:", audioTrack);
    
    // Push-to-Talkモードが有効な場合、最初はマイクを無効にする
    if (isPushToTalkEnabled) {
      audioTrack.enabled = false;
      console.log("🔇 Initial microphone disabled (Push-to-Talk mode)");
    }
    
    pc.addTrack(audioTrack);

    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel("oai-events");
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    //const baseUrl = "gpt-4o-mini-realtime-preview-2024-12-17";
    const sdpResponse = await fetch(`${baseUrl}?model=${selectedModel}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);

    peerConnection.current = pc;
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    console.log("🛑 Stopping session...");
    
    // タイマーをクリア
    if (spaceKeyTimer.current) {
      clearTimeout(spaceKeyTimer.current);
      spaceKeyTimer.current = null;
    }
    
    // 録音状態をリセット
    isRecordingRef.current = false;
    setIsRecording(false);
    
    if (dataChannel) {
      dataChannel.close();
    }

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }

    if (peerConnection.current) {
      peerConnection.current.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
  }

  // Send a text message to the model
  const sendTextMessage = useCallback((message) => {
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    };

    sendClientEvent(event);
    sendClientEvent({ type: "response.create" });
  }, [sendClientEvent]);

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", (e) => {
        const event = JSON.parse(e.data);
        if (!event.timestamp) {
          event.timestamp = new Date().toLocaleTimeString();
        }

        setEvents((prev) => [event, ...prev]);
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        console.log("🔗 Data channel opened");
        setIsSessionActive(true);
        setEvents([]);
        // データチャンネルが開いたらVAD設定を送信
        setTimeout(() => {
          updateVADSettings();
        }, 100);
      });
    }
  }, [dataChannel, updateVADSettings]);

  // VADスレッショルドが変更されたときに設定を更新
  useEffect(() => {
    if (isSessionActive) {
      updateVADSettings();
    }
  }, [vadThreshold, isSessionActive, updateVADSettings]);

  // 感度レベルの判定関数
  const getSensitivityLevel = (threshold) => {
    if (threshold <= 0.2) return "超高感度";
    if (threshold <= 0.5) return "高感度";
    if (threshold <= 0.8) return "中感度";
    if (threshold < 0.95) return "低感度";
    if (threshold < 1.0) return "超低感度・要調整";
    return "無効";
  };

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} />
          <h1>realtime console</h1>
          
          {/* Push-to-Talk制御パネル */}
          <div className="ml-auto flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isPushToTalkEnabled}
                onChange={togglePushToTalk}
                disabled={isSessionActive}
              />
              <span className="text-sm">Push-to-Talk モード</span>
            </label>
            
            {isPushToTalkEnabled && (
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-500' : 'bg-gray-300'}`}></div>
                <span className="text-sm">
                  {isRecording ? `録音中（${pushToTalkTimeLimit/1000}秒で自動停止）` : 'スペースキーを押して話す'}
                </span>
              </div>
            )}
          </div>
        </div>
      </nav>
      
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <section className="absolute top-0 left-0 right-[380px] bottom-0 flex">
          <section className="absolute top-0 left-0 right-0 bottom-32 px-4 overflow-y-auto">
            <EventLog events={events} />
          </section>
          <section className="absolute h-32 left-0 right-0 bottom-0 p-4">
            <SessionControls
              startSession={startSession}
              stopSession={stopSession}
              sendClientEvent={sendClientEvent}
              sendTextMessage={sendTextMessage}
              events={events}
              isSessionActive={isSessionActive}
              isPushToTalkEnabled={isPushToTalkEnabled}
              isRecording={isRecording}
              startRecording={startRecording}
              stopRecording={stopRecording}
            />
          </section>
        </section>
        <section className="absolute top-0 w-[380px] right-0 bottom-0 p-4 pt-0 overflow-y-auto">
          {/* VADスレッショルド調整UI */}
          <div className="bg-gray-50 rounded-md p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">マイク感度設定</h3>
              <button
                onClick={resetVadThreshold}
                className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                disabled={isPushToTalkEnabled}
                title={`デフォルト値 (${vadThresholdDefault}) にリセット`}
              >
                リセット
              </button>
            </div>
            
            {/* 環境変数情報表示 */}
            <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2">
              <p className="text-xs text-blue-800">
                🔧 設定範囲: {vadThresholdMin} - {vadThresholdMax} (ステップ: {vadThresholdStep})
                <br/>
                📋 デフォルト値: {vadThresholdDefault}
              </p>
            </div>
            
            {isPushToTalkEnabled && (
              <div className="bg-yellow-100 border border-yellow-300 rounded p-2 mb-2">
                <p className="text-xs text-yellow-800">
                  ⚠️ Push-to-Talkモード中はVAD設定は無効です
                </p>
              </div>
            )}
            <div className={`flex flex-col gap-2 ${isPushToTalkEnabled ? 'opacity-50' : ''}`}>
              <label className="text-xs text-gray-600">
                VADスレッショルド: {vadThreshold.toFixed(2)} ({getSensitivityLevel(vadThreshold)})
              </label>
              <input
                type="range"
                min={vadThresholdMin}
                max={vadThresholdMax}
                step={vadThresholdStep}
                value={vadThreshold}
                onChange={(e) => validateAndSetVadThreshold(parseFloat(e.target.value))}
                className="w-full"
                disabled={isPushToTalkEnabled}
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>超高感度<br/>{vadThresholdMin}</span>
                <span>中間<br/>{((vadThresholdMax + vadThresholdMin) / 2).toFixed(1)}</span>
                <span>調整範囲<br/>{vadThresholdMax}</span>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                環境変数で設定可能な範囲内で調整してください。
              </p>
              {vadThreshold >= 0.95 && (
                <div className="bg-blue-50 border border-blue-200 rounded p-2">
                  <p className="text-xs text-blue-800">
                    💡 現在は超低感度域です。0.96-0.99で最適値を見つけてください。
                  </p>
                </div>
              )}
              <div className="flex gap-1 mt-2">
                {[0.96, 0.97, 0.98, 0.99, 1.00].filter(val => val >= vadThresholdMin && val <= vadThresholdMax).map(val => (
                  <button
                    key={val}
                    onClick={() => validateAndSetVadThreshold(val)}
                    className={`px-2 py-1 text-xs rounded ${
                      val === 1.00 
                        ? 'bg-red-200 hover:bg-red-300' 
                        : 'bg-gray-200 hover:bg-gray-300'
                    }`}
                    disabled={isPushToTalkEnabled}
                  >
                    {val.toFixed(2)}
                  </button>
                ))}
              </div>
              {isSessionActive && !isPushToTalkEnabled && (
                <button
                  onClick={() => updateVADSettings()}
                  className="mt-2 px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                >
                  設定を再送信
                </button>
              )}
            </div>
          </div>
              
          <ToolPanel
            sendClientEvent={sendClientEvent}
            sendTextMessage={sendTextMessage}
            events={events}
            isSessionActive={isSessionActive}
          />
        </section>
      </main>
    </>
  );
}