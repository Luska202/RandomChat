from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import uuid

app = Flask(__name__)
app.config['SECRET_KEY'] = 'sua_chave_secreta'
socketio = SocketIO(app, cors_allowed_origins="*")

waiting_users = {'text': [], 'video': [], 'voice': []}
rooms = {}
user_data = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('register')
def handle_register(data):
    user_data[request.sid] = {
        'name': data['name'],
        'gender': data['gender']
    }

@socketio.on('join_queue')
def handle_join_queue(data):
    modality = data['modality']
    user_sid = request.sid

    # Remove de salas antigas
    for room, users in list(rooms.items()):
        if user_sid in users:
            socketio.emit('partner_left', room=user_sid)
            del rooms[room]
            break

    for m in waiting_users:
        if user_sid in waiting_users[m]:
            waiting_users[m].remove(user_sid)

    waiting_users[modality].append(user_sid)
    match_users(modality)

def match_users(modality):
    queue = waiting_users[modality]
    while len(queue) >= 2:
        user1 = queue.pop(0)
        user2 = queue.pop(0)

        room_id = str(uuid.uuid4())
        rooms[room_id] = [user1, user2]

        join_room(room_id, sid=user1)
        join_room(room_id, sid=user2)

        name1 = user_data.get(user1, {}).get('name', 'Desconhecido')
        name2 = user_data.get(user2, {}).get('name', 'Desconhecido')

        socketio.emit('matched', {
            'room': room_id,
            'modality': modality,
            'offerer': True,
            'partner_name': name2
        }, room=user1)

        socketio.emit('matched', {
            'room': room_id,
            'modality': modality,
            'offerer': False,
            'partner_name': name1
        }, room=user2)

@socketio.on('leave')
def handle_leave(data):
    room = data.get('room')
    if room and room in rooms:
        user1, user2 = rooms[room]
        socketio.emit('partner_left', room=user2)
        socketio.emit('partner_left', room=user1)
        leave_room(room, sid=user1)
        leave_room(room, sid=user2)
        del rooms[room]
    for m in waiting_users:
        if request.sid in waiting_users[m]:
            waiting_users[m].remove(request.sid)

@socketio.on('signal')
def handle_signal(data):
    room = data['room']
    signal = data['signal']
    sender = request.sid
    if room in rooms:
        users = rooms[room]
        target = users[1] if users[0] == sender else users[0]
        emit('signal', {'signal': signal}, room=target)

@socketio.on('text_message')
def handle_text_message(data):
    room = data['room']
    message = data['message']
    sender = request.sid
    if room in rooms:
        users = rooms[room]
        target = users[1] if users[0] == sender else users[0]
        sender_name = user_data.get(sender, {}).get('name', 'Desconhecido')
        emit('text_message', {'message': message, 'sender_name': sender_name}, room=target)

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    for m in waiting_users:
        if sid in waiting_users[m]:
            waiting_users[m].remove(sid)
    for room, users in list(rooms.items()):
        if sid in users:
            other = users[1] if users[0] == sid else users[0]
            socketio.emit('partner_left', room=other)
            del rooms[room]
            break
    if sid in user_data:
        del user_data[sid]

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)