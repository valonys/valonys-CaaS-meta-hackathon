// Browser runtime control for WebRTC, which CSP connect-src does not govern. Inlined in <head>, it
// runs before any app code and:
//  - replaces the WebRTC constructors on the page's window with permanent stubs that throw, so
//    computed access (window["RTCPeer" + "Connection"]) gets the stub too;
//  - refuses every way to get a fresh same-origin window that would carry untouched constructors:
//    document.createElement/createElementNS for frame-like tags, and window.open;
//  - cancels any top-level navigation that would leave the page's origin (location.assign/replace/
//    href, anchor clicks, ...) through the Navigation API's cancelable "navigate" event. That API
//    exists in Chromium; elsewhere navigation is held by the static ban on location/navigation/history
//    and by CSP form-action 'self' for forms.
// HTML-string sinks (innerHTML, insertAdjacentHTML, document.write, DOMParser, srcdoc) are closed by
// the CSP's Trusted Types directives, and workers/frames by worker-src/frame-src/child-src 'none'.
export const WEBRTC_CONSTRUCTORS = ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceTransport", "RTCSctpTransport", "RTCDtlsTransport", "RTCRtpSender", "RTCRtpReceiver"];
export const FRAME_TAGS = ["iframe", "frame", "frameset", "object", "embed", "portal", "fencedframe"];

export const WEBRTC_OFF_SCRIPT = `(function(w){
var lock=function(o,k,v){try{Object.defineProperty(o,k,{value:v,writable:false,configurable:false,enumerable:false})}catch(e){}};
var n=${JSON.stringify(WEBRTC_CONSTRUCTORS)};
for(var i=0;i<n.length;i++){lock(w,n[i],function(){throw new Error("WebRTC is disabled in Integrity Copilot")})}
var tags=${JSON.stringify(FRAME_TAGS)};
var D=w.Document&&w.Document.prototype;
if(D){
 var ce=D.createElement,cens=D.createElementNS;
 lock(D,"createElement",function(t){if(tags.indexOf(String(t).toLowerCase())>=0)throw new Error("frames are disabled in Integrity Copilot");return ce.apply(this,arguments)});
 lock(D,"createElementNS",function(ns,t){if(tags.indexOf(String(t).toLowerCase().split(":").pop())>=0)throw new Error("frames are disabled in Integrity Copilot");return cens.apply(this,arguments)});
}
lock(w,"open",function(){throw new Error("new windows are disabled in Integrity Copilot")});
if(w.navigation&&w.navigation.addEventListener){w.navigation.addEventListener("navigate",function(e){var ok=false;try{ok=new URL(e.destination.url).origin===w.location.origin}catch(x){}if(!ok&&e.cancelable)e.preventDefault()})}
})(window);`;
