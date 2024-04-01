const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken')
const PDFDocument = require('pdfkit');


const mysql = require('mysql2');
const cors = require("cors")
const app = express();
const port = 3002;
const multer = require('multer');





// MySQL Connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "Malinge?1",
    database: "voting_system",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

db.connect((err) => {
    if (err) throw err;
    console.log('Connected to MySQL database');
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));


// Set storage engine
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Directory where uploaded files will be stored
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname); // Use the original filename
    }
});

// Initialize multer with the storage engine
const upload = multer({ storage: storage });
app.use(cors());

// User Registration
app.post('/register', (req, res) => {
    const { username, password, role } = req.body; // Extract username, password, and role from request body
    const sql = 'INSERT INTO users (username, password, role) VALUES (?, ?, ?)'; // Modify SQL query to include role
    db.query(sql, [username, password, role], (err, result) => {
        if (err) {
            res.status(500).send('Error registering user');
            return;
        }
        res.status(200).send('User registered successfully');
    });
});




// GET request to fetch candidate details
app.get('/candidates', (req, res) => {
    const sql = 'SELECT * FROM candidates'; // SQL query to fetch all candidates
    db.query(sql, (err, result) => {
        if (err) {
            res.status(500).send('Error fetching candidates');
            return;
        }
        console.log(result)
        res.status(200).json(result); // Send the fetched candidates as JSON response
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username = ? AND password = ?';
    db.query(sql, [username, password], (err, results) => {
        if (err) {
            res.status(500).send('Error logging in');
            return;
        }
        if (results.length === 0) {
            res.status(401).send('Invalid username or password');
            return;
        }
        // Authentication successful, generate JWT token
        const user = results[0];
        
        const token = jwt.sign({ userId: user.id, username: user.firstname, role: user.role }, 'secret_key');
        console.log(token)
        res.status(200).json({ token });
    });
});
// Middleware for login authentication
function authenticate(req, res, next) {
    // Extract the JWT token from the Authorization header
    const authToken = req.headers.authorization;

    // Check if the token exists
    if (!authToken) {
        return res.status(401).send('Unauthorized: No token found in request headers');
    }

    try {
        // Verify the JWT token
        const decoded = jwt.verify(authToken.split(' ')[1], 'secret_key'); // Extract the token part after "Bearer"

        // Attach the decoded token data to the request object
        req.user = decoded;

        // Check the role of the user
        const { role } = decoded;
        if (role !== 'voter' && role !== 'admin' && role !== 'candidate') {
            return res.status(403).send('Forbidden: Invalid user role');
        }

        // Proceed with the next middleware or route handler
        next();
    } catch (error) {
        console.error('Error verifying token:', error);
        // If the token is invalid, return an unauthorized error
        return res.status(401).send('Unauthorized: Invalid token');
    }
}

// Admin Approval Process
app.put('/candidates/:id/approve', authenticate, (req, res) => {
    
    const { id } = req.params;

    // Update candidate status to approved in the database
    const approveCandidateQuery = 'UPDATE candidates SET status = "approved" WHERE id = ?';
    db.query(approveCandidateQuery, [id], (err, result) => {
        if (err) {
            res.status(500).send('Error approving candidate');
            return;
        }
        // Upon approval, create a user account for the candidate
        // Generate a unique username and temporary password
        const username = `candidate_${id}`;
        const password = Math.random().toString(36).slice(-8); // Generate a random 8-character password

        // Insert the candidate's details into the users table
        const createUserQuery = 'INSERT INTO users (username, password, role) VALUES (?, ?, "candidate")';
        db.query(createUserQuery, [username, password], (err, result) => {
            if (err) {
                res.status(500).send('Error creating candidate account');
                return;
            }
            res.status(200).json({ username, password });
        });
    });

});

// Candidate Registration
app.post('/candidates', authenticate,  upload.single('image'), (req, res) => {
    const { firstName, lastName, post, state } = req.body;
    const image = req.file ? req.file.path : ''; // Retrieve the path of the uploaded image, if any

    const sql = 'INSERT INTO candidates (first_name, last_name, post, state, image, status) VALUES (?, ?, ?, ?, ?, "pending")'; // Initial status is pending
    db.query(sql, [firstName, lastName, post, state, image], (err, result) => {
        if (err) {
            res.status(500).send('Error registering candidate');
            console.log(err);
            return;
        }
        res.status(200).send('Candidate application submitted successfully');
    });
});


app.post('/vote', authenticate, (req, res) => {
    const  voter_id  = req.user.userId; // Retrieve voter ID from the authenticated user
    //const  voter_id  = 1;

    const { candidate_id, post } = req.body;

    // Check if the voter has already voted for the given post
    const checkVoteQuery = 'SELECT * FROM votes WHERE voter_id = ? AND post = ?';
    db.query(checkVoteQuery, [voter_id, post], (err, results) => {
        if (err) {
            res.status(500).send('Error checking previous vote');
            return;
        }
        if (results.length > 0) {
            // Retrieve the list of posts the voter has already voted for
            const votedPosts = results.map(vote => vote.post).join(', ');
            res.status(400).send(`You have already voted for the following post(s): ${votedPosts}`);
            return;
        }
        
        // Check if the candidate exists
        const checkCandidateQuery = 'SELECT * FROM candidates WHERE id = ? AND post = ?';
        db.query(checkCandidateQuery, [candidate_id, post], (err, results) => {
            if (err) {
                res.status(500).send('Error checking candidate');
                return;
            }
            if (results.length === 0) {
                res.status(404).send('Candidate not found for the specified post');
                return;
            }

            // Insert the vote
            const insertVoteQuery = 'INSERT INTO votes (voter_id, candidate_id, post) VALUES (?, ?, ?)';
            db.query(insertVoteQuery, [voter_id, candidate_id, post], (err, result) => {
                if (err) {
                    console.error(err);
                    res.status(500).send('Error voting');
                    return;
                }
                // Update success notification message
                res.status(200).send('Vote submitted successfully');
            });
        });
    });
});


// Result Analysis
app.get('/results',  (req, res) => {
   

    const sql = 'SELECT candidates.post, candidates.name, COUNT(*) AS votes_count FROM candidates JOIN votes ON candidates.id = votes.candidate_id GROUP BY candidates.post, candidates.name';
    db.query(sql, (err, result) => {
        if (err) {
            console.error('Error fetching results:', err);
            res.status(500).send('Error fetching results');
            return;
        }
        res.status(200).json(result);
    });
});
// Route to fetch list of posts
app.get('/posts',  (req, res) => {
    const sql = 'SELECT DISTINCT post FROM candidates';
    db.query(sql, (err, result) => {
      if (err) {
        console.error('Error fetching posts:', err);
        res.status(500).send('Error fetching posts');
        return;
      }
      const posts = result.map((row) => row.post);
      res.status(200).json(posts);
      console.log(posts)
    });
  });
  
  // Route to fetch candidates' reports sorted by post
  app.get('/candidates-reports/:post',   (req, res) => {
   
    const { post } = req.params;
    const sql = `
      SELECT candidates.*, COUNT(votes.id) AS votes_count
      FROM candidates
      LEFT JOIN votes ON candidates.id = votes.candidate_id
      WHERE candidates.post = ?
      GROUP BY candidates.id
      ORDER BY votes_count DESC
    `;
    db.query(sql, [post], (err, result) => {
      if (err) {
        console.error('Error fetching candidates:', err);
        res.status(500).send('Error fetching candidates');
        return;
      }
      res.status(200).json(result);
    });
  });


app.get('/generate-candidate-report',  (req, res) => {
    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="candidate_report.pdf"');
    doc.pipe(res);

    const sql = 'SELECT * FROM candidates';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching candidates:', err);
            res.status(500).send('Error fetching candidates');
            return;
        }
        
        doc.fontSize(24).text('Candidate Details Report', { align: 'center' });
        doc.moveDown();
        results.forEach((candidate, index) => {
            doc.fontSize(16).text(`Candidate ${index + 1}: ${candidate.name}`, { align: 'left' });
            doc.fontSize(12).text(`Post: ${candidate.post}`, { align: 'left' });
            doc.fontSize(12).text(`State: ${candidate.state}`, { align: 'left' });
            doc.moveDown();
        });

        doc.end();
    });
});

// Route to generate voting results report
app.get('/generate-voting-results-report',  (req, res) => {
    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="voting_results_report.pdf"');
    doc.pipe(res);

    const sql = 'SELECT candidates.post, candidates.name, COUNT(*) AS votes_count FROM candidates JOIN votes ON candidates.id = votes.candidate_id GROUP BY candidates.post, candidates.name';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching voting results:', err);
            res.status(500).send('Error fetching voting results');
            return;
        }

        doc.fontSize(24).text('Voting Results Report', { align: 'center' });
        doc.moveDown();
        results.forEach((result, index) => {
            doc.fontSize(16).text(`Post: ${result.post}`, { align: 'left' });
            doc.fontSize(12).text(`Candidate: ${result.name}`, { align: 'left' });
            doc.fontSize(12).text(`Votes Count: ${result.votes_count}`, { align: 'left' });
            doc.moveDown();
        });

        doc.end();
    });
});


// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
