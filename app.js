var express = require('express')

var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;

var cookieParser = require('cookie-parser');
var session = require('express-session');
var bodyParser = require('body-parser');

var Datastore = require('nedb');

var bcrypt = require('bcrypt-nodejs');

var _ = require('underscore');

var path = require('path');

app = express();

// Connect to databases
var prefix = process.env.OPENSHIFT_DATA_DIR || '';
var usersdb = new Datastore({filename: path.join(prefix, 'users.db')});
var groupsdb = new Datastore({filename: path.join(prefix, 'groups.db')});
var billsdb = new Datastore({filename: path.join(prefix, 'bills.db')});
usersdb.loadDatabase();
groupsdb.loadDatabase();
billsdb.loadDatabase();
usersdb.persistence.setAutocompactionInterval(60000);
groupsdb.persistence.setAutocompactionInterval(60000);
billsdb.persistence.setAutocompactionInterval(60000);

// Configure passport

passport.serializeUser(function(user, done) {
	// Persist just the user's id
	done(null, user._id);
});

passport.deserializeUser(function(id, done) {
	// Lookup user by id
	usersdb.find({_id: id}, function(err, docs) {
		done(null, docs[0]);
	});
});

passport.use(new LocalStrategy({
	usernameField: 'email',
	passwordField: 'password'
}, function(email, password, done) {

	usersdb.find({email: email}, function(err, docs) {
		if (!docs[0]) done(null, false, {error: 'User does not exist'});
		if (bcrypt.compareSync(password, docs[0].phash)) {
			done(null, docs[0]);
		}
		done(null, false, {error: 'Incorrect password'});
	});

}));

// Stack middleware

// Standard express middleware for parsing the request data into req.body
app.use(bodyParser());
app.use(cookieParser());


// Configure sessions
app.use(session({
	secret: 'gfslieVZugRnpzkDWu1XkQwgf6iJVRpXwsMOsmBoi8t50e012C6k9cajNVt5zJT'
}));

// Install the passport middleware
app.use(passport.initialize()); 
app.use(passport.session());


// Routing middleware

// Log in to a user account
// request parameters: {user}
app.post('/login', passport.authenticate('local'), function(req, res, next) {
	res.send(req.user);
});

// Log out
app.get('/logout', function(req, res, next) {
	req.logout();
	res.redirect('/');
});

// Register a new user by email
// request parameters: {email}
app.post('/register', function(req, res, next) {
	usersdb.find({email: req.body.email}, function(err, docs) {
		if (!docs[0]) {
			usersdb.insert({email: req.body.email, phash: bcrypt.hashSync(req.body.password), name: req.body.name});
			res.send("OK");
		} else {
			res.status(400).send("User already exists");
		}
	});
});

// Halts the request passing through with a 401 if there is no user logged in
var auth = function(req, res, next) {
	if (req.user) {
		return next();
	} else {
		res.status(401).send("Must login");
	}
};

// Get the current user
app.get('/login', auth, function(req, res, next) {
	res.send(req.user);
});

// Get up to 10 users whose name contains 'name'
app.get('/users/:name', auth, function(req, res, next) {
	usersdb.find({$where: function() {return this.name.indexOf(req.params.name) > -1}}).limit(10).exec(function(err, results) {
		res.send(results);
	});
});

// Make a user a member of a group
// request parameters: {userId, groupId}
app.post('/users/', auth, function(req, res, next) {
	groupsdb.update({_id: req.body.groupId}, {$addToSet: {members: req.body.userId}}, {}, function(err, ur) {
		res.send("OK");
	});
});

// Returns groups for which the currently logged in user is a member
app.get('/groups', auth, function(req, res, next) {
	if (req.user) {
		groupsdb.find({$where: function() {return _.contains(this.members, req.user._id)}}, function(err, groups) {
			res.send(groups);
		});
	} else {
		res.status(401).send("Must login");
	}
});


// Create a new group
// request parameters: {<group parameters>}
app.post('/groups', auth, function(req, res, next) {
	if (req.user) {
		groupsdb.insert(req.body, function(err, nr) {
			res.send("OK");
		});
	} else {
		res.status(401).send("Must login");
	}
});

// Update a group
// request parameters: {id, newGroup}
app.put('/groups', auth, function(req, res, next) {
	if (req.user) {
		groupsdb.update({_id: req.body.id}, req.body.newGroup, {}, function(err, ur) {
			res.send("OK");
		});
	} else {
		res.status(401).send("Must login");
	}
});

// Delete a group
// request parameters: {id}
app.delete('/groups', auth, function(req, res, next) {
	if (req.user) {
		groupsdb.remove({_id: req.body.id}, {}, function(err, nr) {
			res.send("OK");
		});
	} else {
		res.status(401).send("Must login");
	}
});

// Get the bills associated with the group of id 'groupId'
app.get('/bills/:groupId', auth, function(req, res, next) {
	billsdb.find({owner: req.params.groupId}).sort({date: -1}).exec(function(err, bills) {
		res.send(bills);
	});
});

// Create a new bill
// request parameters: {<bill parameters>}
app.post('/bills', auth, function(req, res, next) {
	billsdb.insert(req.body);
	res.send("OK");
});

// Update a bill
// request parameters: {id, replacement}
app.put('/bills', auth, function(req, res, next) {
	billsdb.update({_id: req.body.id}, req.body.replacement, {}, function(err, ur) {
		res.send("OK");
	});
})

// Delete a bill
// request parameters: {id}
app.delete('/bills', auth, function(req, res, next) {
	billsdb.remove({_id: req.body.id}, {}, function(err, nr) {
		res.send("OK");
	});
});

// Get the users that are responsible for paying the bill with id 'billId'
app.get('/payers/:billId', auth, function(req, res, next) {
	billsdb.find({_id: req.params.billId}, function(err, bills) {
		usersdb.find({_id: {$in: bills[0].payers}}, function(err, users) {
			res.send(users);
		});
	});
});

// Get the members of the group with id 'groupId'
app.get('/members/:groupId', auth, function(req, res, next) {
	groupsdb.find({_id: req.params.groupId}, function(err, groups) {
		usersdb.find({_id: {$in: groups[0].members}}, function(err, users) {
			res.send(users);
		});
	});
});


// Finally, serve static files from the 'static' directory
app.use(express.static('static'));

var serverPort = process.env.OPENSHIFT_NODEJS_PORT || 8000;
var serverIPAddress = process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1';

// Launch the app
app.listen(serverPort, serverIPAddress, function() {
	console.log('Server running');
});