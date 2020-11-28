// autotouch
const { touchDown, touchMove, touchUp, usleep, toast, findImage } = at

// sleep in one second chunks so we can abort easier
function sleep(seconds) {
    let microsecondsToSleep = seconds * 1000000;

    const napLength = 1000000; // 1 second

    while(microsecondsToSleep > 0) {
        if(microsecondsToSleep > 3000000 && (microsecondsToSleep / 1000000 % 3 == 0)) {
            toast(`${microsecondsToSleep/1000000} seconds left`, 1);
        }
        if(microsecondsToSleep > napLength) {
            usleep(napLength);
            microsecondsToSleep -= napLength;
        } else {
            usleep(microsecondsToSleep);
            microsecondsToSleep = 0;
        }
    }
}

// swipe from (x,y) to (newx,newy)
// if remain = true, don't lift up the finger at the end
// this took a lot of trial and error
function swipe(x, y, newx, newy, finger = 1, remain = false, delayInSeconds = 0.1) {
    
    touchDown(finger, x, y);
    let step = 15; // how many intermediate places to move the "finger"
    for (let i = 0; i <= step; i++) {
        // a function that moves from 0 to 1 as x goes from 0 to 1, but decelerates as it gets close to 1
        let scale = Math.sqrt(Math.sin(Math.PI*0.5*(i/step)));
        // scale the progression of the finger according to the scaling function
        let stepx = (newx-x)*scale+x;
        let stepy = (newy-y)*scale+y;
        touchMove(finger, stepx, stepy);
		usleep(5000);
    }
    if(!remain) {
        touchUp(finger, newx, newy);
    }
    sleep(delayInSeconds);
}

function areColorsPresentInRegion(colors, region) {
    var options = { colors: colors, region: region};
    var [result, error] = at.findColors(options);

    if(result.length > 0) {
        return true;
    } else {
        return false;
    }
}

function findColorsInRegion(colors, region) {
    var options = { colors: colors, region: region};
    var [result, error] = at.findColors(options);

    if(result.length > 0) {
        return result[0];
    } else {
        return null;
    }
}

// execute the provided function for the specified amount of time
// returns true if the function evaluated to true, false otherwise (i.e. the timeout was hit)
function poll(pollFunction, timeoutInSeconds = 5, intervalInSeconds = 1, throwOnTimeoutMessage = null) {
    const INTERMEDIATE_SLEEP_TIME_IN_MICROSECONDS = 1000000;
    const SECONDS_BETWEEN_PROGRESS_MESSAGE = 3;
    let microsecondsToSleep = timeoutInSeconds * 1000000;

    const napLength = intervalInSeconds * INTERMEDIATE_SLEEP_TIME_IN_MICROSECONDS;
    var result = false;

    while(microsecondsToSleep > 0) {
        result = pollFunction();
        if(result) {
            break;
        }
        if(microsecondsToSleep > SECONDS_BETWEEN_PROGRESS_MESSAGE*1000000 
            && (microsecondsToSleep / 1000000 % SECONDS_BETWEEN_PROGRESS_MESSAGE == 0)) {
            toast(`${microsecondsToSleep/1000000} seconds left`, 1);
        }
        if(microsecondsToSleep > napLength) {
            usleep(napLength);
            microsecondsToSleep -= napLength;
        } else {
            usleep(microsecondsToSleep);
            microsecondsToSleep = 0;
        }
    }

    if(throwOnTimeoutMessage != null && !result) {
        alert(`${throwOnTimeoutMessage} timed out`);
        at.stop();
    }
    return result;
}

function tap(x, y, timeInUs = 150000, finger = 1) {
    touchDown(finger, x, y);
    usleep(timeInUs);
    touchUp(finger, x, y);
}

// some buttons are occasionally "sticky" so we need to tap them twice
function doubleTap(x, y, timeInUs = 150000, finger = 1, delayInUs = 50000) {
    tap(x, y, timeInUs, finger);
    usleep(delayInUs);
    tap(x, y, timeInUs, finger);
}

function tapMiddle(region, time = 150000, finger = 1) {
    tap(region.x + region.width/2, region.y + region.height/2, time, finger);
}

// reads text in the region. if it times out (5s) or errors, will return empty string
// some words that don't work: EXT
// sometimes multiple words get reordered like "Lv. Auto-Regen L" instead of "Auto-Region Lv. 1"
function readText(region, minHeight = 0.5, level = 1) {
    const options = {
        region: region,
        customWords: ['Espers'],
        minimumTextHeight: minHeight, // OPTIONAL, the minimum height of the text expected to be recognized, relative to the region/screen height, default is 1/32
        level: level, // OPTIONAL, 0 means accurate first, 1 means speed first
        correct: false, // OPTIONAL, whether use language correction during the recognition process.
    }

    var text = null;
    
    at.recognizeText(options, (result, error) => {
        if (error) {
            text = "";
            alert(error)
        } else {
            if(result.length >= 1) {
                text = result[0].text;
            } else {
                text = "";
            }
        }
    })

    poll(function(){ return text != null }, 5, 0.1);

    return text;
}

function debug(message) {
    if(global.debugEnabled) {
        console.log(`${message}`);
    }
}

module.exports = {
    // basic gestures
    swipe, sleep, tap, tapMiddle, doubleTap,
    // color & text recognition, polling
    readText, areColorsPresentInRegion, poll, findColorsInRegion,
    // debug
    debug
}