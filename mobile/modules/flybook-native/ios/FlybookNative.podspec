Pod::Spec.new do |s|
  s.name           = 'FlybookNative'
  s.version        = '1.0.0'
  s.summary        = 'FlyBook system voices and PDF text'
  s.description    = 'Renders system text-to-speech to audio files and extracts PDF text on device.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
    
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
