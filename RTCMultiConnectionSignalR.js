import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'

function RTCMultiConnectionSignalR (connection, connectCallback) {
  if (!connection.signalrHubURL) {
    throw new Error('connection.signalrHubURL is required!')
  }

  var mPeer = connection.multiPeersHandler

  function isData (session) {
    return !session.audio && !session.video && !session.screen && session.data
  }

  function updateExtraBackup (remoteUserId, extra) {
    if (!connection.peersBackup[remoteUserId]) {
      connection.peersBackup[remoteUserId] = {
        userid: remoteUserId,
        extra: {}
      }
    }

    connection.peersBackup[remoteUserId].extra = extra
  }

  function onMessageEvent (message) {
    if (message.sender === connection.userid) return

    if (connection.peers[message.sender] && connection.peers[message.sender].extra !== message.message.extra) {
      connection.peers[message.sender].extra = message.extra
      connection.onExtraDataUpdated({
        userid: message.sender,
        extra: message.extra
      })

      updateExtraBackup(message.sender, message.extra)
    }

    if (message.message.streamSyncNeeded && connection.peers[message.sender]) {
      var stream = connection.streamEvents[message.message.streamid]
      if (!stream || !stream.stream) {
        return
      }

      var action = message.message.action

      if (action === 'ended' || action === 'inactive' || action === 'stream-removed') {
        if (connection.peersBackup[stream.userid]) {
          stream.extra = connection.peersBackup[stream.userid].extra
        }
        connection.onstreamended(stream)
        return
      }

      var type = message.message.type !== 'both' ? message.message.type : null

      if (typeof stream.stream[action] === 'function') {
        stream.stream[action](type)
      }
      return
    }

    if (message.message === 'dropPeerConnection') {
      connection.deletePeer(message.sender)
      return
    }

    if (message.message.allParticipants) {
      if (message.message.allParticipants.indexOf(message.sender) === -1) {
        message.message.allParticipants.push(message.sender)
      }

      message.message.allParticipants.forEach(function (participant) {
        mPeer[!connection.peers[participant] ? 'createNewPeer' : 'renegotiatePeer'](participant, {
          localPeerSdpConstraints: {
            OfferToReceiveAudio: connection.sdpConstraints.mandatory.OfferToReceiveAudio,
            OfferToReceiveVideo: connection.sdpConstraints.mandatory.OfferToReceiveVideo
          },
          remotePeerSdpConstraints: {
            OfferToReceiveAudio: connection.session.oneway ? !!connection.session.audio : connection.sdpConstraints.mandatory.OfferToReceiveAudio,
            OfferToReceiveVideo: connection.session.oneway ? !!connection.session.video || !!connection.session.screen : connection.sdpConstraints.mandatory.OfferToReceiveVideo
          },
          isOneWay: !!connection.session.oneway || connection.direction === 'one-way',
          isDataOnly: isData(connection.session)
        })
      })
      return
    }

    if (message.message.newParticipant) {
      if (message.message.newParticipant === connection.userid) return
      if (connection.peers[message.message.newParticipant]) return

      mPeer.createNewPeer(message.message.newParticipant, message.message.userPreferences || {
        localPeerSdpConstraints: {
          OfferToReceiveAudio: connection.sdpConstraints.mandatory.OfferToReceiveAudio,
          OfferToReceiveVideo: connection.sdpConstraints.mandatory.OfferToReceiveVideo
        },
        remotePeerSdpConstraints: {
          OfferToReceiveAudio: connection.session.oneway ? !!connection.session.audio : connection.sdpConstraints.mandatory.OfferToReceiveAudio,
          OfferToReceiveVideo: connection.session.oneway ? !!connection.session.video || !!connection.session.screen : connection.sdpConstraints.mandatory.OfferToReceiveVideo
        },
        isOneWay: !!connection.session.oneway || connection.direction === 'one-way',
        isDataOnly: isData(connection.session)
      })
      return
    }

    if (message.message.readyForOffer) {
      if (connection.attachStreams.length) {
        connection.waitingForLocalMedia = false
      }

      if (connection.waitingForLocalMedia) {
        // if someone is waiting to join you
        // make sure that we've local media before making a handshake
        setTimeout(function () {
          onMessageEvent(message)
        }, 1)
        return
      }
    }

    if (message.message.newParticipationRequest && message.sender !== connection.userid) {
      if (connection.peers[message.sender]) {
        connection.deletePeer(message.sender)
      }

      var userPreferences = {
        extra: message.extra || {},
        localPeerSdpConstraints: message.message.remotePeerSdpConstraints || {
          OfferToReceiveAudio: connection.sdpConstraints.mandatory.OfferToReceiveAudio,
          OfferToReceiveVideo: connection.sdpConstraints.mandatory.OfferToReceiveVideo
        },
        remotePeerSdpConstraints: message.message.localPeerSdpConstraints || {
          OfferToReceiveAudio: connection.session.oneway ? !!connection.session.audio : connection.sdpConstraints.mandatory.OfferToReceiveAudio,
          OfferToReceiveVideo: connection.session.oneway ? !!connection.session.video || !!connection.session.screen : connection.sdpConstraints.mandatory.OfferToReceiveVideo
        },
        isOneWay: typeof message.message.isOneWay !== 'undefined' ? message.message.isOneWay : !!connection.session.oneway || connection.direction === 'one-way',
        isDataOnly: typeof message.message.isDataOnly !== 'undefined' ? message.message.isDataOnly : isData(connection.session),
        dontGetRemoteStream: typeof message.message.isOneWay !== 'undefined' ? message.message.isOneWay : !!connection.session.oneway || connection.direction === 'one-way',
        dontAttachLocalStream: !!message.message.dontGetRemoteStream,
        connectionDescription: message,
        successCallback: function () {}
      }

      connection.onNewParticipant(message.sender, userPreferences)
      return
    }

    if (message.message.changedUUID) {
      if (connection.peers[message.message.oldUUID]) {
        connection.peers[message.message.newUUID] = connection.peers[message.message.oldUUID]
        delete connection.peers[message.message.oldUUID]
      }
    }

    if (message.message.userLeft) {
      mPeer.onUserLeft(message.sender)

      if (message.message.autoCloseEntireSession) {
        connection.leave()
      }

      return
    }

    mPeer.addNegotiatedMessage(message.message, message.sender)
  }

  const onCallbacks = {}

  let joining = false

  connection.socket = {
    emit (eventName, data, emitCallback) {
      if (eventName === 'changed-uuid') return
      if (data.message && data.message.shiftedModerationControl) return

      if (eventName === 'join-room') {
        joining = true
      }

      hubConnection.invoke(connection.signalrHubMethodName || 'Send', connection.channel, JSON.stringify({
        eventName: eventName,
        data: data
      }))

      if (emitCallback) {
        emitCallback(true, connection.channel)
      }
    },
    on (eventName, onCallback) {
      onCallbacks[eventName] = onCallbacks[eventName] || []
      onCallbacks[eventName].push(onCallback)
    },
    off (eventName, onCallback) {
      if (onCallbacks[eventName]) {
        const idx = onCallbacks.findIndex(cb => cb === onCallback)
        if (idx > -1) {
          onCallbacks.splice(idx, 1)
        }
      }
    },
    disconnect () {
      hubConnection.stop()
    }
  }

  const hubConnection = new HubConnectionBuilder()
    .withUrl(connection.signalrHubURL)
    .withAutomaticReconnect()
    .configureLogging(connection.enableLogs ? LogLevel.Information : LogLevel.Error)
    .build()

  hubConnection.on(connection.channel, (message) => {
    const messageObject = JSON.parse(message)

    if (messageObject.eventName === connection.socketMessageEvent && messageObject.data && messageObject.data.message && messageObject.data.message.userLeft) {
      joining = false
    }

    // only process messages if participant is joining or already joined
    // otherwise it results in ICE candidate errors
    if (joining) {
      switch (messageObject.eventName) {
        case connection.socketMessageEvent:
          onMessageEvent(messageObject.data)
          break
        case 'presence':
          if (messageObject.data.userid === connection.userid) return
          connection.onUserStatusChanged({
            userid: messageObject.data.userid,
            status: messageObject.data.isOnline === true ? 'online' : 'offline',
            extra: connection.peers[messageObject.data.userid] ? connection.peers[messageObject.data.userid].extra : {}
          })
          break
        default:
          break
      }
    }
    if (onCallbacks[messageObject.eventName]) {
      onCallbacks[messageObject.eventName].forEach(cb => {
        cb(messageObject.data)
      })
    }
  })

  hubConnection.start().then(() => {
    connection.socket.emit('presence', {
      userid: connection.userid,
      isOnline: true
    })

    if (connectCallback) {
      connectCallback(connection.socket)
    }
  })
}

export default RTCMultiConnectionSignalR
