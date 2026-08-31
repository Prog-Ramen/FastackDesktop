{
  "targets": [
    {
      "target_name": "keyboard_addon",
      "sources": ["addon.cc"],
      "include_dirs": [],
      "conditions": [
        ["OS=='mac'", {
          "link_settings": {
            "libraries": [
              "-framework CoreGraphics",
              "-framework CoreFoundation"
            ]
          }
        }]
      ]
    }
  ]
}
