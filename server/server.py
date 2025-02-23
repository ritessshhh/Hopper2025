from flask import Flask, jsonify
import subprocess

app = Flask(__name__)

@app.route('/run_transcription', methods=['GET'])
def run_transcription():
    print("woohoo")
    try:
        result = subprocess.run(["python3", "client/transcription.py"], capture_output=True, text=True)
        print(result)
        return jsonify({"transcript": result.stdout})
    except Exception as e:
        return jsonify({"error": str(e)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
