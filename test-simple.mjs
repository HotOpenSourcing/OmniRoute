// Test simple OAuth token exchange
const code = "code-478888f44eb3";

async function test() {
    console.log("Testing OAuth token exchange...");
    
    try {
        const response = await fetch("https://zcode.z.ai/api/v1/oauth/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ code: code })
        });
        
        const text = await response.text();
        console.log(`Status: ${response.status}`);
        console.log(`Response: ${text}`);
    } catch (error) {
        console.log(`Error: ${error.message}`);
    }
}

test();
