process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => process.stdout.write('echo:' + d))
process.stdout.write('READY\n')
setInterval(() => {}, 1000)
