var isAccelerator = require("electron-is-accelerator");

$(document).ready(function () {
    // Show "Push to Cloud" only in Local mode.
    if (ls('platform') === 'Local') {
        $('#syncSection').show();
        function startMigration(target) {
            var repoInput = ($('#syncRepoName').val() || '').trim();
            var reRepo = /^[A-Za-z0-9_.-]+$/;
            if (!repoInput) {
                $('#syncStatus').text('Enter a cloud repo/folder name first.');
                return;
            }
            if (!reRepo.test(repoInput)) {
                $('#syncStatus').text('Name can only contain letters, digits, _ . -');
                return;
            }
            ls('migrateTarget', target);
            ls('migrateRepoName', repoInput);
            $('#syncStatus').text('Opening ' + target + ' auth...');
            window.location.replace('../home.html?migrate=' + encodeURIComponent(target));
        }
        $('#syncGithub').on('click', function () { startMigration('Github'); });
        $('#syncDropbox').on('click', function () { startMigration('Dropbox'); });
        $('#syncGoogle').on('click', function () { startMigration('Google'); });
    }
    function keyDown(shortcut) {
        return function curried_func(e) {
            var settings = ls('settings');
            if (e.key != "Escape"){

                if ($('#' + shortcut).val() == "Listening"){
                    $('#' + shortcut).val(e.key);
                    settings[shortcut] = e.key;
                } else {
                    if (!$('#' + shortcut).val().split('+').includes(e.key)){
                        var sc = $('#' + shortcut).val() + "+" + e.key;
                        if (isAccelerator(sc)){
                            $('#' + shortcut).val(sc);
                            settings[shortcut] = sc;
                        }  
                    }
                }
                ls('settings', settings);
            } else {
                window.removeEventListener('keydown', keyDown(shortcut));
            }
        }
    }
    $('#backButton').click(function(){
        window.location.replace('./stack.html');
    })
    getCreateSettings(function(err, result){
        $.each(ls('settings'), function(i, val){

            $(".tab").append(
                `<div class="taskInput">
                        <label for="tname">`+ i.match(/[A-Z][a-z]+/g).map(x => x).join(' ').trim() +`</label><br><br>
                        <input readonly id="` + i +`" type="text" name="openClose" value="`+val+`">
                    </div><br></br>`
            );
            $('#' + i).focusin(function(){
                $('#' + i).val('Listening');
                var curried = keyDown(i);
                window.addEventListener('keydown', curried);
                $('#' + i).focusout(function(){
                    if($('#' + i).val() == "Listening"){
                        $('#' + i).val(result[i]);
                    }
                    window.removeEventListener('keydown', curried);
                });
            });
            
          });
        
    });
    $('#updateSettings').on('submit', function(evt){
        evt.preventDefault();
        updateSettings(function(err, result){
            if(err){
                console.log(err);
            }
        })
        window.location.replace('./stack.html');
    });
  
});