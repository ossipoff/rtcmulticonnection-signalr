# RTCMultiConnectionSignalR
Custom socket handler for RTCMultiConnection (https://github.com/muaz-khan/RTCMultiConnection)

## Installation 
```
npm i -s rtcmulticonnection @ossisoft/rtcmulticonnection-signalr
```

## Usage
```
import RTCMultiConnection from 'rtcmulticonnection'
import RTCMultiConnectionSignalR from '@ossisoft/rtcmulticonnection-signalr'

const rtcmConnection = new RTCMultiConnection('public-room')
rtcmConnection.signalrHubURL = 'https://myserver/rtchub' // Required
rtcmConnection.signalrHubMethodName = 'Send' // Optional, default is Send
rtcmConnection.setCustomSocketHandler(RTCMultiConnectionSignalR)
```

## Development
```
git clone https://github.com/ossipoff/rtcmulticonnection-signalr.git
cd rtcmulticonnection-signalr
npm install
npm run build
```
