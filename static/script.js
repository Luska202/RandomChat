const socket = io();
let currentRoom = null;
let currentModality = null;
let localStream = null;
let peerConnection = null;
let isOfferer = false;
let partnerName = '';

// Configuração ICE com política 'relay' para ocultar IPs (exige TURN)
// Substitua pelos seus servidores TURN em produção
const configuration = {
    iceServers: [
        {
            urls: 'turn:turn.seuservidor.com:3478',  // Exemplo: turn.example.com
            username: 'seu_usuario',
            credential: 'sua_senha'
        },
        {
            urls: 'turns:turn.seuservidor.com:5349', // TURN sobre TLS
            username: 'seu_usuario',
            credential: 'sua_senha'
        }
    ],
    iceTransportPolicy: 'relay' // Força apenas candidatos relay (TURN)
};

// Elementos DOM
const loginScreen = document.getElementById('login-screen');
const choiceScreen = document.getElementById('choice-screen');
const chatScreen = document.getElementById('chat-screen');
const genderSelect = document.getElementById('gender-select');
const customGender = document.getElementById('custom-gender');
const enterBtn = document.getElementById('enter-btn');
const modalityBtns = document.querySelectorAll('.modality-btn');
const nextBtn = document.getElementById('next-btn');
const textChat = document.getElementById('text-chat');
const videoChat = document.getElementById('video-chat');
const voiceChat = document.getElementById('voice-chat');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendMsgBtn = document.getElementById('send-msg');
const partnerInfo = document.getElementById('partner-info');
const notificationDiv = document.getElementById('notification');

// Elementos de vídeo
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localNameSpan = document.getElementById('localName');
const remoteNameSpan = document.getElementById('remoteName');
const zoomToggle = document.getElementById('zoom-toggle');
const sizeSlider = document.getElementById('video-size-slider');
const remoteVideoWrapper = document.querySelector('.remote-video-wrapper');

// Elementos de voz
const localAvatar = document.getElementById('localAvatar');
const remoteAvatar = document.getElementById('remoteAvatar');
const localVoiceName = document.getElementById('localVoiceName');
const remoteVoiceName = document.getElementById('remoteVoiceName');
const remoteAudio = document.getElementById('remoteAudio');

// Mostrar campo personalizado se "Outro" for selecionado
genderSelect.addEventListener('change', () => {
    customGender.style.display = genderSelect.value === 'other' ? 'block' : 'none';
});

// Entrar: registrar no servidor e ir para escolha de modalidade
enterBtn.addEventListener('click', () => {
    const username = document.getElementById('username').value.trim();
    let gender = genderSelect.value;
    if (gender === 'other') gender = customGender.value.trim();
    if (!username || !gender) return showNotification('Preencha todos os campos', 3000);

    localStorage.setItem('username', username);
    socket.emit('register', { name: username, gender: gender });
    loginScreen.style.display = 'none';
    choiceScreen.style.display = 'block';
});

// Escolher modalidade
modalityBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        currentModality = btn.dataset.modality;
        choiceScreen.style.display = 'none';
        chatScreen.style.display = 'block';
        showModalityUI(currentModality);
        partnerInfo.innerText = 'Procurando...';
        socket.emit('join_queue', { modality: currentModality });
    });
});

function showModalityUI(modality) {
    textChat.style.display = 'none';
    videoChat.style.display = 'none';
    voiceChat.style.display = 'none';
    if (modality === 'text') textChat.style.display = 'block';
    else if (modality === 'video') videoChat.style.display = 'block';
    else if (modality === 'voice') voiceChat.style.display = 'block';
}

// Quando emparelhado com alguém
socket.on('matched', async (data) => {
    currentRoom = data.room;
    isOfferer = data.offerer;
    partnerName = data.partner_name;
    partnerInfo.innerText = `Conectado com ${partnerName}`;

    const myName = localStorage.getItem('username') || 'Você';
    if (currentModality === 'video') {
        localNameSpan.innerText = myName;
        remoteNameSpan.innerText = partnerName;
        // Ajusta tamanho inicial do vídeo remoto conforme slider
        if (remoteVideoWrapper && sizeSlider) {
            remoteVideoWrapper.style.width = sizeSlider.value + 'px';
        }
    } else if (currentModality === 'voice') {
        localVoiceName.innerText = myName;
        remoteVoiceName.innerText = partnerName;
        document.getElementById('voiceWave').style.animation = 'pulse 2s infinite ease-in-out';
    }

    if (currentModality === 'video' || currentModality === 'voice') {
        try {
            await startWebRTC(currentModality);
        } catch (e) {
            console.error('Erro ao iniciar mídia:', e);
            showNotification('Não foi possível acessar câmera/microfone. Verifique as permissões.', 4000);
        }
    }
});

// Signaling WebRTC
socket.on('signal', async (data) => {
    if (!peerConnection) return;
    try {
        const signal = data.signal;
        if (signal.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', { room: currentRoom, signal: answer });
        } else if (signal.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
        } else if (signal.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(signal));
        }
    } catch (e) {
        console.error('Erro no signaling:', e);
    }
});

async function startWebRTC(modality) {
    const constraints = {
        video: modality === 'video',
        audio: true
    };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);

    if (modality === 'video') {
        localVideo.srcObject = localStream;
    }

    peerConnection = new RTCPeerConnection(configuration);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        if (modality === 'video') {
            remoteVideo.srcObject = event.streams[0];
        } else if (modality === 'voice') {
            remoteAudio.srcObject = event.streams[0];
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            // Não registramos o candidato no console (privacidade)
            socket.emit('signal', { room: currentRoom, signal: event.candidate });
        }
    };

    // Opcional: monitorar estado da conexão (sem expor IPs)
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE state:', peerConnection.iceConnectionState);
    };

    if (isOfferer) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', { room: currentRoom, signal: offer });
    }
}

// Texto
sendMsgBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const msg = messageInput.value.trim();
    if (msg && currentRoom) {
        socket.emit('text_message', { room: currentRoom, message: msg });
        appendMessage('Você: ' + msg, true);
        messageInput.value = '';
    }
}

socket.on('text_message', (data) => {
    appendMessage(data.sender_name + ': ' + data.message, false);
});

function appendMessage(text, isOwn = false) {
    const msgDiv = document.createElement('div');
    msgDiv.textContent = text;
    msgDiv.classList.add('message');
    if (isOwn) msgDiv.classList.add('own');
    else msgDiv.classList.add('other');
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Próximo (sair da conversa e procurar novo parceiro)
nextBtn.addEventListener('click', () => {
    leaveCurrentRoom();
    partnerInfo.innerText = 'Procurando...';
    socket.emit('join_queue', { modality: currentModality });
});

function leaveCurrentRoom() {
    if (currentRoom) {
        socket.emit('leave', { room: currentRoom });
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        currentRoom = null;
        // Parar animação de voz
        document.getElementById('voiceWave').style.animation = 'none';
        // Resetar tamanho do vídeo remoto para o valor do slider
        if (remoteVideoWrapper && sizeSlider) {
            remoteVideoWrapper.style.width = sizeSlider.value + 'px';
        }
    }
}

// Parceiro saiu
socket.on('partner_left', () => {
    showNotification(`${partnerName} saiu da conversa.`, 3000);
    leaveCurrentRoom();
    partnerInfo.innerText = 'Procurando...';
    socket.emit('join_queue', { modality: currentModality });
});

// Notificação flutuante
function showNotification(message, duration = 3000) {
    notificationDiv.innerText = message;
    notificationDiv.classList.remove('hidden');
    setTimeout(() => {
        notificationDiv.classList.add('hidden');
    }, duration);
}

// Slider para redimensionar o vídeo remoto
if (sizeSlider && remoteVideoWrapper) {
    sizeSlider.addEventListener('input', (e) => {
        remoteVideoWrapper.style.width = e.target.value + 'px';
    });
}

// Botão de zoom alterna entre tamanhos predefinidos
if (zoomToggle && sizeSlider && remoteVideoWrapper) {
    zoomToggle.addEventListener('click', () => {
        const currentVal = parseInt(sizeSlider.value);
        if (currentVal < 800) {
            sizeSlider.value = 900;
            remoteVideoWrapper.style.width = '900px';
        } else {
            sizeSlider.value = 600;
            remoteVideoWrapper.style.width = '600px';
        }
    });
}