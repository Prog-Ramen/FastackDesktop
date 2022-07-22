const base64 = require('base-64');
var ls = require('local-storage');
var cryptoHelper = require('./crypto_helper');
ls('countdownTimer', {'id': 0});

exports.createTask = function(taskName, startDate, creationDate, completionDate, ignoreDates, timeHours, timeMins, priority, description, tags, notes, timeTaken, complete) {
    var taskObject = {
        taskName: taskName,
        startDate: startDate,
        creationDate: creationDate,
        completionDate: completionDate,
        ignoreDates: ignoreDates,
        timeHours: timeHours,
        timeMins: timeMins,
        priority: priority,
        description: description,
        tags: tags,
        notes: notes,
        timeTaken: timeTaken,
        complete: complete
    }
    return taskObject;
}

exports.stackSort = function(){
    var stack = ls('stack')['incomplete'];
    stack.sort(function(a,b){
        var dec_b = decryptTask(b);
        var dec_a = decryptTask(a);
        return (dec_b.ignoreDates - dec_a.ignoreDates) || (!dec_b.ignoreDates && !dec_a.ignoreDates && (new Date(dec_a.startDate) - new Date(dec_b.startDate))) || dec_b.priority - dec_a.priority ||  (!dec_b.ignoreDates && !dec_a.ignoreDates && (new Date(dec_a.completionDate) - new Date(dec_b.completionDate))) ;
      })
    var stack_length = stack.length;
    var overdue = []
    var first = 0;
    var count = 0;
    for (var i = 0; i < stack_length; i++){
    var task = this.decryptTask(stack[i]);
    if (new Date(task.completionDate) < new Date() && !task.ignoreDates){
        if (count == 0){
        first = i;
        }
        overdue.push(stack[i]);
        count++;
    }
    }
    overdue.sort(function(a,b){
        var dec_b = decryptTask(b);
        var dec_a = decryptTask(a);
        return dec_b.priority - dec_a.priority;
    });
    stack.splice(first, count);
    stack = overdue.concat(stack);
    ls('stack', {'incomplete': stack, 'complete': ls('stack')['complete']});
    return stack;
}

exports.encryptTask = function(task){
    var encTask = {};
    if (!ls('key')) {
        return task;
    }
    for (var key in task) {
        var encrypted = cryptoHelper.encrypt(task[key].toString(), ls('key'));
        encTask[key] = encrypted;
    }
    return encTask;   
}

var encryptItem = exports.encryptItem = function(task, key){
    if (!ls('key')) {
        return task[key];
    }
    var encrypted = cryptoHelper.encrypt(task[key].toString(), ls('key'));
    return encrypted;
}

exports.generateTranslate = function(stack_length, index, current) {
    var height = 85/(stack_length-1);
    var overhead = -40/(stack_length-1);
    if (stack_length == 1){
        height = 100;
    }
    if (stack_length > 6){
        height = 85/5;
        overhead = -40/5;
    }
    var translate = index>0?"transform: translateY(" + overhead*index + "vh); ":"";
    var actualH = index!=current?"height: " + height + "%;":"height: 50%;";
    translate = translate+actualH;
    translate = translate + ` z-index: ${index<current?(stack_length+index-current):(stack_length-index+current)};`;
    overhead = overhead + 2/(stack_length-1);
    return [translate, overhead];
}

exports.getRandomTheme = function() {
    let utf8Encode = new TextEncoder();
    var bytesArray = utf8Encode.encode('{"input": [[0,168,157],[100,129,16],"N",[0,0,0],"N"], "model":"ui"}');
    $.ajax({
        url: 'http://colormind.io/api/',
        type: 'POST',
        contentType: 'application/octet-stream',  
        data: bytesArray,
        async: false,
        processData: false,
        success: function(result){
            
        }, error: function(error){
            console.log(error);
        }
        });
}

exports.isToday = function(someDate) {
    var today = new Date();
    return someDate.getDate() == today.getDate() &&
      someDate.getMonth() == today.getMonth() &&
      someDate.getFullYear() == today.getFullYear()
  }


exports.previousDate = function(someDate) {
    var today = new Date();
    return someDate.getDate() < today.getDate();
}

exports.futureDate = function(someDate) {
    var today = new Date();
    return someDate.getDate() > today.getDate();
}
 
//+ </h2>':'<h2>'+decrypted['taskName']+'
//<th><h2>${decrypted['taskName'].length>12?decrypted['taskName'].slice(0,12)+"...":decrypted['taskName']}</h2></th>
exports.generateTaskHTML = function(index, translate, decrypted,overhead, status,current) {
    var color = "";
    if (status == "overdue"){
        color = "#DC143C;";
    } else if (status == "active"){
        color = "#00A89D;";
    } else {
        color = "#FFD700;";
    }
    return `<div id="t${index}" class="task taskName" style="background: ${color}${translate}; opacity: ${index != current?1/(Math.abs(current-index)+1):0.9}">` +
            `<table align="center" ${index>current?"style='position:absolute; top: "+ -overhead*1.1+"vh;'":""}>
            <tr>
              <th><h2 class="header">${decrypted['taskName']}</h2></th>
              <th id="status" style="text-align:right;"><h2>${status}</h2></th>            
            </tr>
            ${!decrypted['ignoreDates']?
            `<tr>
              <th>From: </th>
              <td>${new Date(decrypted['startDate']).toLocaleString().replace(/:00 |,/gi, '')}</td>
            </tr>
            <tr>
              <th>To: </th>
              <td>${new Date(decrypted['completionDate']).toLocaleString().replace(/:00 |,/gi, '')}</td>
            </tr>`:``
            }
            <tr>
              <th>Duration: </th>
              <td>${decrypted['timeHours']} hours ${decrypted['timeMins']} mins<br></td>
            </tr>
            <tr>
              <th>Priority: </th>
              <td>${decrypted['priority']}<br></td>
            </tr>
            <tr>
              <th>Tags: </th>
              <td>${decrypted['tags']}<br></td>
            </tr>
            <tr>
              <th>Created At: </th>
              <td>${new Date(decrypted['creationDate']).toLocaleString().replace(/:00 |,/gi, '')}<br></td>
            </tr>
            </table>
            </div>`;
}

exports.generateFullStackHTML = function(current){
    var return_val = "";
    var stack_length = ls('stack')['incomplete'].length;
    for (var index = 0; index < stack_length; index++){
        var result = this.generateTranslate(stack_length, index, current);
        var translate = result[0];
        var overhead = result[1];
        // Since we deal with Firefox and Chrome only
        var decrypted = this.decryptTask(ls('stack')['incomplete'][index]);
        var status = this.generateStatus(decrypted);
        return_val += this.generateTaskHTML(index, translate, decrypted, overhead, status, current);
    }
    return return_val;
}

exports.generateStatus = function(decrypted_task){
    var status = "";
    if (!decrypted_task.ignoreDates){
        var current = new Date();
        var start = new Date(decrypted_task.startDate);
        var comp = new Date(decrypted_task.completionDate);
        
        if (current >= start && current <= comp) {
            status = "active";
        } else if (current < start) {
            status = "upcoming";
        } else if (current > comp) {
            status = "overdue";
        }
    } else {
        status = "active";
    }
    return status;
}

exports.countdown = function(index){
    // Set the date we're counting down to
    var task = stackFunctions.decryptTask(ls('stack')['incomplete'][index]);
    var dt = new Date();
    dt.setHours(dt.getHours() + parseInt(task.timeHours));
    dt.setMinutes(dt.getMinutes() + parseInt(task.timeMins));
    dt.setSeconds(dt.getSeconds() - (parseInt(task.timeTaken)/1000));

    // Update the count down every 1 second
    var x = setInterval(function() {
    var stack = ls('stack')['incomplete'];
    var task = stackFunctions.decryptTask(stack[index]);

    // Get today's date and time
    var now = new Date().getTime();
        
    // Find the distance between now and the count down date
    var distance = dt.getTime() - now;
    var secHours = parseInt(task.timeHours) * (1000 * 60 * 60);
    var secMins = parseInt(task.timeMins) * (1000 * 60);
    stack[index].timeTaken = (secHours+secMins) - distance;
    stack[index].timeTaken = encryptItem(stack[index], 'timeTaken');
    ls('stack', {'incomplete': stack, 'complete': ls('stack')['complete']});
        
    // Time calculations for days, hours, minutes and seconds
    var hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    var seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
    // Output the result in an element with id="demo"
    document.getElementById("status").innerHTML = '<h3 id="inside">' + hours + "h "
    + minutes + "m " + seconds + "s </h3>";
    document.getElementById("inside").classList.add("blink_me");
        

    }, 1000);
    return x;
}

exports.clockIn = function(index){
    if (ls('countdownTimer')['id'] == 0){
        ls('countdownTimer', {'id': this.countdown(index)});
    }
}

exports.clockOut = function(){
    clearInterval(ls('countdownTimer')['id']);
    document.getElementById("status").innerHTML = '<h2>' + this.generateStatus(this.decryptTask(ls('stack')['incomplete'][0])) + '</h2>';
    ls('countdownTimer', {'id': 0});
}

var decryptTask = exports.decryptTask = function(task){
    var decTask = {};
    if (!ls('key')) {
        return task;
    }
    for (var key in task) {
        var decrypted = cryptoHelper.decrypt(task[key], ls('key'));
        if (key == "ignoreDates" || key == "complete"){
            decTask[key] = (decrypted === 'true');
        } else {    
            decTask[key] = decrypted;
        }
        
    }      
    return decTask;   
}

exports.decryptItem = function(task, key){
    if (!ls('key')) {
        return task[key];
    }
    var decrypted = cryptoHelper.decrypt(task[key], ls('key'));
    if (key == "ignoreDates" || key == "complete"){
        return (decrypted === 'true');
    } else {
        return decrypted;
    }
}
